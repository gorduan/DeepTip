//! The window tree and its timing (SPEC §3): previews and pinned windows, the invariants of §3.2, the hot set,
//! grace time, mouse tendency, suppression, arming delays and the timer lock.
//!
//! UI-agnostic and deterministic: the UI layer reports what the pointer is over ([`Engine::set_hover`]), pointer
//! samples, clicks and keys, and calls [`Engine::tick`] with the current time in milliseconds. Every decision of
//! the web reference (`frameworks/web/deeptip.js`) is made here, so it can be unit-tested without a window.

use std::collections::{HashSet, VecDeque};

use crate::placement::{Rect, Side, CHILD_SIDES, ROOT_SIDES};

/// Identifier of an open window (unique for the lifetime of an [`Engine`]).
pub type WinId = u64;

/// A window may stay open this long (ms) while the pointer keeps heading towards it.
pub const TENDENCY_MAX: f64 = 1500.0;
/// Holding Esc (or gamepad B) this long (ms) closes every window.
pub const HOLD: f64 = 600.0;
/// Re-check interval (ms) while the mouse tendency holds a timer.
pub const RETRY: f64 = 90.0;
/// Duration (ms) of the flash that points at a window already open further up the chain.
pub const FLASH: f64 = 700.0;
/// Smaller pointer movements (px) have no tendency.
pub const MIN_MOVE: f64 = 3.0;
/// Pointer samples older than this (ms) are dropped (at least two are kept).
pub const SAMPLE_WINDOW: f64 = 120.0;
/// Without a pointer sample for this long (ms) the pointer counts as resting: no tendency.
pub const SAMPLE_STALE: f64 = 80.0;
/// Padding (px) around a window for the tendency ray test.
pub const TENDENCY_PAD: f64 = 12.0;
/// A long-press may drift this far (px).
pub const MOVE_TOL: f64 = 10.0;
/// A downward swipe of this length (px) on a window's title bar closes all windows.
pub const SWIPE: f64 = 60.0;

/// When pressing outside every window closes them all (`outsideClickCloses`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OutsideClick {
    /// Never.
    Never,
    /// Only for touch presses (default).
    #[default]
    Touch,
    /// For every press.
    Always,
}

/// Options with the reference defaults (SPEC §7). Times in milliseconds.
#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    /// Rest time on a UI element before its window opens (0 = at once). Per element override possible.
    pub delay: f64,
    /// Hover time on a term before its preview opens.
    pub link_delay: f64,
    /// Grace before an unpinned window closes once the pointer left it.
    pub close_delay: f64,
    /// Resting inside a preview this long pins it (timer lock); 0 = off.
    pub lock_after: f64,
    /// Touch press that opens a window (informational where the toolkit detects long presses itself).
    pub long_press: f64,
    /// X button in every window.
    pub close_buttons: bool,
    /// Pin toggle in every window.
    pub pin_button: bool,
    /// "Click to pin · Esc closes" line in previews.
    pub hints: bool,
    /// A click anywhere inside a preview pins it.
    pub click_inside_pins: bool,
    /// When pressing outside every window closes them all.
    pub outside_click_closes: OutsideClick,
    /// Side order of the first window next to its UI element.
    pub root: Vec<Side>,
    /// Side order of a further window next to the window it came from.
    pub child: Vec<Side>,
    /// Gap between window and anchor, and to the viewport edge (px).
    pub gap: f64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            delay: 800.0,
            link_delay: 80.0,
            close_delay: 300.0,
            lock_after: 0.0,
            long_press: 500.0,
            close_buttons: true,
            pin_button: true,
            hints: true,
            click_inside_pins: true,
            outside_click_closes: OutsideClick::Touch,
            root: ROOT_SIDES.to_vec(),
            child: CHILD_SIDES.to_vec(),
            gap: 8.0,
        }
    }
}

/// What a window belongs to (SPEC §3.1). Two windows never share an anchor.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum AnchorId {
    /// A UI element marked with a key; the host's stable widget id.
    Element(u64),
    /// A term inside a window: the window, the key, and which occurrence of that key in the window (0 = first),
    /// so the anchor survives a language switch.
    Term(WinId, String, u32),
    /// A term placed directly on a page (outside any window): the id of the text and the link's ordinal.
    Page(u64, u32),
}

/// How a window was opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Via {
    /// By the host ([`Engine::open`] from code).
    Api,
    /// Resting / hovering.
    Hover,
    /// Click on a term.
    Click,
    /// Keyboard (F1, ?, Enter).
    Key,
    /// Touch long-press.
    Touch,
    /// Gamepad.
    Pad,
}

/// An open window.
#[derive(Clone, Debug)]
pub struct Window {
    /// Its id.
    pub id: WinId,
    /// The glossary key it shows.
    pub key: String,
    /// The window that contains the term it was opened from (`None` = root).
    pub parent: Option<WinId>,
    /// What it belongs to.
    pub anchor: AnchorId,
    /// How it was opened.
    pub via: Via,
    /// Pinned windows close only on an explicit action.
    pub pinned: bool,
    /// Windows opened from terms in this one, oldest first.
    pub children: Vec<WinId>,
    /// 0 for roots.
    pub depth: usize,
    /// The window's box as last laid out (for the mouse tendency). Set by the UI layer.
    pub rect: Option<Rect>,
    /// A root's anchor rectangle as last seen. Set by the UI layer.
    pub anchor_rect: Option<Rect>,
    /// A root whose anchor vanished while pinned: it stays where it is.
    pub frozen: bool,
    flash_at: Option<f64>,
    leave: Option<Leave>,
}

#[derive(Clone, Copy, Debug)]
struct Leave {
    since: f64,
    check_at: f64,
}

/// A term under the pointer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkHover {
    /// The term's anchor.
    pub anchor: AnchorId,
    /// Its target key.
    pub key: String,
    /// The window that contains it (`None` = a term on a page).
    pub parent: Option<WinId>,
}

/// A marked UI element under the pointer.
#[derive(Clone, Debug, PartialEq)]
pub struct TrigHover {
    /// The element's anchor.
    pub anchor: AnchorId,
    /// Its key.
    pub key: String,
    /// Own rest time (ms), `None` = [`Options::delay`].
    pub delay: Option<f64>,
}

/// What the pointer is over. `trig` is only set when the pointer is neither in a window nor on a term.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Hover {
    /// The top-most window under the pointer.
    pub win: Option<WinId>,
    /// A term under the pointer.
    pub link: Option<LinkHover>,
    /// A marked UI element under the pointer.
    pub trig: Option<TrigHover>,
}

/// Something the host may want to know about (`onOpen`, `onClose`, `onPin`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    /// A window opened.
    Opened {
        /// The window.
        win: WinId,
        /// Its key.
        key: String,
    },
    /// A window closed.
    Closed {
        /// The window.
        win: WinId,
        /// Its key.
        key: String,
    },
    /// A window was pinned.
    Pinned {
        /// The window.
        win: WinId,
        /// Its key.
        key: String,
    },
    /// A window went back to being a preview.
    Unpinned {
        /// The window.
        win: WinId,
        /// Its key.
        key: String,
    },
}

#[derive(Clone, Debug)]
struct Pending {
    anchor: AnchorId,
    key: String,
    parent: Option<WinId>,
    is_link: bool,
    delay: f64,
    since: f64,
    fire_at: f64,
}

#[derive(Clone, Copy, Debug)]
struct Sample {
    x: f64,
    y: f64,
    t: f64,
}

/// The window tree with its timers. See the module docs.
#[derive(Clone, Debug, Default)]
pub struct Engine {
    /// Behaviour and timing options; may be changed at any time.
    pub options: Options,
    wins: Vec<Window>,
    next_id: WinId,
    hover: Hover,
    hot: HashSet<WinId>,
    pending: Option<Pending>,
    quiet: Option<AnchorId>,
    samples: VecDeque<Sample>,
    lock: Option<(WinId, f64)>,
    events: Vec<Event>,
    focus_request: Option<WinId>,
}

impl Engine {
    /// A new engine without windows.
    pub fn new(options: Options) -> Self {
        Self { options, next_id: 1, ..Self::default() }
    }

    /* ------------------------------------------------------------------ queries */

    /// Open windows, oldest first (= stacking order, the newest on top).
    pub fn windows(&self) -> &[Window] {
        &self.wins
    }

    /// A window by id.
    pub fn get(&self, id: WinId) -> Option<&Window> {
        self.wins.iter().find(|w| w.id == id)
    }

    fn get_mut(&mut self, id: WinId) -> Option<&mut Window> {
        self.wins.iter_mut().find(|w| w.id == id)
    }

    /// Is the window open?
    pub fn is_open(&self, id: WinId) -> bool {
        self.get(id).is_some()
    }

    /// The window that belongs to `anchor`, if any.
    pub fn window_for(&self, anchor: &AnchorId) -> Option<WinId> {
        self.wins.iter().find(|w| &w.anchor == anchor).map(|w| w.id)
    }

    /// What the pointer is over, as last reported.
    pub fn hover(&self) -> &Hover {
        &self.hover
    }

    /// Is the window hot (pointer on its anchor, inside it, or inside anything opened from it)?
    pub fn is_hot(&self, id: WinId) -> bool {
        self.hot.contains(&id)
    }

    /// `w` itself or one of its ancestors is `ancestor`.
    pub fn is_in_chain(&self, w: WinId, ancestor: WinId) -> bool {
        let mut x = Some(w);
        while let Some(id) = x {
            if id == ancestor {
                return true;
            }
            x = self.get(id).and_then(|w| w.parent);
        }
        false
    }

    /// The side order for a window: its own for roots (`own`), else [`Options::root`] / [`Options::child`].
    pub fn sides(&self, id: WinId, own: Option<&[Side]>) -> Vec<Side> {
        let Some(w) = self.get(id) else { return vec![Side::Bottom] };
        let s: Vec<Side> = match (w.parent, own) {
            (None, Some(own)) if !own.is_empty() => own.to_vec(),
            (None, _) => self.options.root.clone(),
            (Some(_), _) => self.options.child.clone(),
        };
        if s.is_empty() {
            vec![Side::Bottom]
        } else {
            s
        }
    }

    /// The anchor that is arming (pointer resting on it) and its progress 0‥1 (`data-dt-arming`). Only for
    /// UI elements, not for terms.
    pub fn arming(&self, now: f64) -> Option<(&AnchorId, f64)> {
        let p = self.pending.as_ref().filter(|p| !p.is_link)?;
        let progress = if p.delay <= 0.0 { 1.0 } else { ((now - p.since) / p.delay).clamp(0.0, 1.0) };
        Some((&p.anchor, progress))
    }

    /// Timer-lock progress 0‥1 of the window the pointer rests in (`data-dt-locking`).
    pub fn lock_progress(&self, id: WinId, now: f64) -> Option<f64> {
        let (w, since) = self.lock?;
        (w == id && self.options.lock_after > 0.0).then(|| ((now - since) / self.options.lock_after).clamp(0.0, 1.0))
    }

    /// Flash progress 0‥1 while the window is flashing.
    pub fn flash_progress(&self, id: WinId, now: f64) -> Option<f64> {
        let at = self.get(id)?.flash_at?;
        let t = (now - at) / FLASH;
        (0.0..1.0).contains(&t).then_some(t)
    }

    /// Events since the last call (opened, closed, pinned, unpinned).
    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    /// A window that should receive keyboard focus (opened or reached by keyboard / gamepad).
    pub fn take_focus_request(&mut self) -> Option<WinId> {
        self.focus_request.take().filter(|id| self.is_open(*id))
    }

    /* ------------------------------------------------------------------ the tree (SPEC §3.2) */

    /// Open the window for `key` at `anchor` (a UI element, or a term inside `parent`).
    ///
    /// Invariants: the same anchor reuses its window (pinning it if asked); the same key further up the chain
    /// flashes that window instead; a new preview replaces the unpinned sibling of the same parent.
    /// Returns the window that shows the key, or `None` when the parent is not open.
    #[allow(clippy::too_many_arguments)]
    pub fn open(
        &mut self,
        key: &str,
        anchor: AnchorId,
        parent: Option<WinId>,
        pinned: bool,
        focus: bool,
        via: Via,
        now: f64,
    ) -> Option<WinId> {
        if key.is_empty() || parent.is_some_and(|p| !self.is_open(p)) {
            return None;
        }
        if let Some(same) = self.window_for(&anchor) {
            if pinned {
                self.pin(same);
            }
            if focus {
                self.focus_request = Some(same);
            }
            return Some(same);
        }
        // the same term further up this chain: point at it instead of opening it twice
        let mut x = parent;
        while let Some(id) = x {
            let w = self.get(id)?;
            if w.key == key {
                self.flash(id, now);
                if focus {
                    self.focus_request = Some(id);
                }
                return Some(id);
            }
            x = w.parent;
        }
        // one preview per level: a new window replaces its unpinned sibling
        let siblings: Vec<WinId> = self.wins.iter().filter(|w| w.parent == parent && !w.pinned).map(|w| w.id).collect();
        for s in siblings {
            self.close(s);
        }
        let id = self.next_id.max(1);
        self.next_id = id + 1;
        let depth = parent.and_then(|p| self.get(p)).map_or(0, |p| p.depth + 1);
        self.wins.push(Window {
            id,
            key: key.to_owned(),
            parent,
            anchor,
            via,
            pinned: false,
            children: Vec::new(),
            depth,
            rect: None,
            anchor_rect: None,
            frozen: false,
            flash_at: None,
            leave: None,
        });
        if let Some(p) = parent.and_then(|p| self.get_mut(p)) {
            p.children.push(id);
        }
        if pinned {
            self.pin(id);
        }
        if focus {
            self.focus_request = Some(id);
        }
        self.refresh_hot(now);
        self.events.push(Event::Opened { win: id, key: key.to_owned() });
        Some(id)
    }

    /// Close a window and everything opened from it.
    pub fn close(&mut self, id: WinId) {
        let Some(w) = self.get(id) else { return };
        for c in w.children.clone() {
            self.close(c);
        }
        let Some(i) = self.wins.iter().position(|w| w.id == id) else { return };
        let w = self.wins.remove(i);
        if let Some(p) = w.parent.and_then(|p| self.get_mut(p)) {
            p.children.retain(|&c| c != id);
        }
        self.hot.remove(&id);
        if self.lock.is_some_and(|(l, _)| l == id) {
            self.lock = None;
        }
        if self.focus_request == Some(id) {
            self.focus_request = None;
        }
        self.events.push(Event::Closed { win: id, key: w.key });
    }

    /// Close every window.
    pub fn close_all(&mut self) {
        let roots: Vec<WinId> = self.wins.iter().filter(|w| w.parent.is_none()).map(|w| w.id).collect();
        for r in roots {
            self.close(r);
        }
    }

    /// Pin a window and every window it came from, so a pinned window never hangs off a vanishing one.
    pub fn pin(&mut self, id: WinId) {
        let mut x = Some(id);
        while let Some(cur) = x {
            let Some(w) = self.get_mut(cur) else { break };
            if w.pinned {
                break;
            }
            w.pinned = true;
            w.leave = None;
            let (key, parent) = (w.key.clone(), w.parent);
            self.events.push(Event::Pinned { win: cur, key });
            x = parent;
        }
        if let Some((l, _)) = self.lock {
            if self.get(l).is_none_or(|w| w.pinned) {
                self.lock = None;
            }
        }
    }

    /// Back to a preview (with everything opened from it): it closes once the pointer is elsewhere.
    pub fn unpin(&mut self, id: WinId, now: f64) {
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            if let Some(w) = self.get_mut(cur) {
                if w.pinned {
                    w.pinned = false;
                    let key = w.key.clone();
                    stack.extend(w.children.iter().copied());
                    self.events.push(Event::Unpinned { win: cur, key });
                } else {
                    stack.extend(w.children.iter().copied());
                }
            }
        }
        self.refresh_hot(now);
    }

    /// Pin button: pin a preview, unpin a pinned window.
    pub fn toggle_pin(&mut self, id: WinId, now: f64) {
        match self.get(id).map(|w| w.pinned) {
            Some(true) => self.unpin(id, now),
            Some(false) => self.pin(id),
            None => {}
        }
    }

    fn flash(&mut self, id: WinId, now: f64) {
        if let Some(w) = self.get_mut(id) {
            w.flash_at = Some(now);
        }
    }

    /* ------------------------------------------------------------------ input actions */

    /// Click / Enter / A on a term: its window opens pinned, and so does the chain it hangs off.
    pub fn follow(
        &mut self,
        anchor: AnchorId,
        key: &str,
        parent: Option<WinId>,
        focus: bool,
        now: f64,
    ) -> Option<WinId> {
        self.disarm();
        if let Some(p) = parent {
            self.pin(p);
        }
        if let Some(open) = self.window_for(&anchor) {
            self.pin(open);
            if focus {
                self.focus_request = Some(open);
            }
            return Some(open);
        }
        self.open(key, anchor, parent, true, focus, Via::Click, now)
    }

    /// F1 / ? / gamepad Y / touch long-press on a UI element: its window opens pinned.
    pub fn open_pinned(&mut self, anchor: AnchorId, key: &str, focus: bool, via: Via, now: f64) -> Option<WinId> {
        self.disarm();
        if let Some(open) = self.window_for(&anchor) {
            self.pin(open);
            if focus {
                self.focus_request = Some(open);
            }
            return Some(open);
        }
        self.open(key, anchor, None, true, focus, via, now)
    }

    /// A click inside a preview (not on a term or button) pins it (`clickInsidePins`).
    pub fn click_inside(&mut self, id: WinId) {
        if self.options.click_inside_pins && self.get(id).is_some_and(|w| !w.pinned) {
            self.pin(id);
        }
    }

    /// A pointer press. `in_window`: on a window; `trig`: the marked UI element under it, if any.
    /// A mouse press on an element hushes it (the user is using it, not asking); a press outside every window
    /// closes them all depending on [`Options::outside_click_closes`].
    pub fn pointer_down(&mut self, in_window: bool, trig: Option<&AnchorId>, touch: bool) {
        if in_window {
            return;
        }
        if !touch {
            if let Some(t) = trig {
                self.hush(t);
            }
        }
        let close = match self.options.outside_click_closes {
            OutsideClick::Always => true,
            OutsideClick::Touch => touch,
            OutsideClick::Never => false,
        };
        if close && !self.wins.is_empty() {
            self.close_all();
        }
    }

    /// A click on / typing into a UI element cancels its pending window until the pointer leaves it.
    pub fn hush(&mut self, anchor: &AnchorId) {
        if self.pending.as_ref().is_some_and(|p| &p.anchor == anchor) {
            self.disarm();
        }
        self.quiet = Some(anchor.clone());
    }

    /// The newest window opened from `from` (or `from` itself), else the newest window.
    pub fn newest(&self, from: Option<WinId>) -> Option<WinId> {
        match from.filter(|&f| self.is_open(f)) {
            None => self.wins.last().map(|w| w.id),
            Some(here) => self.wins.iter().rev().find(|w| self.is_in_chain(w.id, here)).map(|w| w.id).or(Some(here)),
        }
    }

    /// Esc / gamepad B tap: close the newest window opened from `from` (the focused window). Returns it.
    pub fn close_newest(&mut self, from: Option<WinId>) -> Option<WinId> {
        let id = self.newest(from)?;
        self.close(id);
        Some(id)
    }

    /// F6 / RB (`step` 1): the next older window; Shift+F6 / LB (`step` -1): newer. `current` = focused window.
    pub fn cycle(&self, current: Option<WinId>, step: i32) -> Option<WinId> {
        let list: Vec<WinId> = self.wins.iter().rev().map(|w| w.id).collect();
        if list.is_empty() {
            return None;
        }
        let n = list.len() as i64;
        match current.and_then(|c| list.iter().position(|&w| w == c)) {
            None => Some(list[0]),
            Some(i) => Some(list[((i as i64 + i64::from(step)).rem_euclid(n)) as usize]),
        }
    }

    /* ------------------------------------------------------------------ pointer and hover (SPEC §3.4) */

    /// A pointer position (mouse or pen; not touch). Feeds the mouse tendency.
    pub fn pointer_moved(&mut self, x: f64, y: f64, now: f64) {
        self.samples.push_back(Sample { x, y, t: now });
        while self.samples.len() > 2 && self.samples.front().is_some_and(|s| now - s.t > SAMPLE_WINDOW) {
            self.samples.pop_front();
        }
    }

    /// Report what the pointer is over. Only a change counts (like `pointerover` events): resting on an element
    /// whose window was closed does not open it again until the pointer leaves it.
    pub fn set_hover(&mut self, hover: Hover, now: f64) {
        if hover == self.hover {
            return;
        }
        if self.quiet.is_some() && self.quiet.as_ref() != hover.trig.as_ref().map(|t| &t.anchor) {
            self.quiet = None;
        }
        self.hover = hover;
        self.refresh_hot(now);
        let lock = self.hover.win.filter(|id| self.get(*id).is_some_and(|w| !w.pinned));
        self.lock_track(lock, now);
        if let Some(l) = self.hover.link.clone() {
            self.arm(l.anchor, l.key, l.parent, true, None, now);
        } else if let Some(t) = self.hover.trig.clone() {
            self.arm(t.anchor, t.key, None, false, t.delay, now);
        } else {
            self.disarm();
        }
    }

    /// Recompute the hot set; unpinned windows that are no longer hot start their grace time.
    fn refresh_hot(&mut self, now: f64) {
        let mut hot = HashSet::new();
        let chain = |start: Option<WinId>, hot: &mut HashSet<WinId>| {
            let mut x = start;
            while let Some(id) = x {
                let Some(w) = self.get(id) else { break };
                if !hot.insert(id) {
                    break;
                }
                x = w.parent;
            }
        };
        chain(self.hover.win, &mut hot);
        let anchor = self.hover.link.as_ref().map(|l| &l.anchor).or(self.hover.trig.as_ref().map(|t| &t.anchor));
        if let Some(a) = anchor {
            let on: Vec<WinId> = self.wins.iter().filter(|w| &w.anchor == a).map(|w| w.id).collect();
            for id in on {
                chain(Some(id), &mut hot);
            }
        }
        self.hot = hot;
        let close_delay = self.options.close_delay;
        for w in &mut self.wins {
            if w.pinned {
                continue;
            }
            if self.hot.contains(&w.id) {
                w.leave = None;
            } else if w.leave.is_none() {
                w.leave = Some(Leave { since: now, check_at: now + close_delay });
            }
        }
    }

    /// Mouse tendency (EU5): the ray of the pointer's recent movement hits the window's box (+12 px).
    pub fn heading(&self, id: WinId, now: f64) -> bool {
        let s = &self.samples;
        let (Some(a), Some(b)) = (s.front(), s.back()) else { return false };
        if s.len() < 2 || now - b.t > SAMPLE_STALE {
            return false;
        }
        let (vx, vy) = (b.x - a.x, b.y - a.y);
        if vx.hypot(vy) < MIN_MOVE {
            return false;
        }
        let Some(r) = self.get(id).and_then(|w| w.rect) else { return false };
        let pad = TENDENCY_PAD;
        let mut t0 = 0.0_f64;
        let mut t1 = f64::INFINITY;
        for (p, v, lo, hi) in [(b.x, vx, r.left - pad, r.right + pad), (b.y, vy, r.top - pad, r.bottom + pad)] {
            if v.abs() < 1e-9 {
                if p < lo || p > hi {
                    return false;
                }
                continue;
            }
            let (mut ta, mut tb) = ((lo - p) / v, (hi - p) / v);
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
            }
            t0 = t0.max(ta);
            t1 = t1.min(tb);
            if t0 > t1 {
                return false;
            }
        }
        true
    }

    /// On the way into a preview, terms crossed on the way must not replace it (the Victoria 3 problem).
    fn heading_away(&self, parent: Option<WinId>, now: f64) -> bool {
        self.wins.iter().any(|w| {
            if w.pinned || parent.is_some_and(|p| self.is_in_chain(p, w.id)) {
                return false;
            }
            self.heading(w.id, now)
        })
    }

    fn arm(&mut self, anchor: AnchorId, key: String, parent: Option<WinId>, is_link: bool, own: Option<f64>, now: f64) {
        if self.pending.as_ref().is_some_and(|p| p.anchor == anchor) {
            return;
        }
        self.disarm();
        if self.quiet.as_ref() == Some(&anchor) || self.window_for(&anchor).is_some() || key.is_empty() {
            return;
        }
        let delay = if is_link { self.options.link_delay } else { own.unwrap_or(self.options.delay) };
        self.pending = Some(Pending { anchor, key, parent, is_link, delay, since: now, fire_at: now + delay.max(0.0) });
    }

    fn disarm(&mut self) {
        self.pending = None;
    }

    fn lock_track(&mut self, win: Option<WinId>, now: f64) {
        let win = if self.options.lock_after > 0.0 { win } else { None };
        if self.lock.map(|(w, _)| w) == win {
            return;
        }
        self.lock = win.map(|w| (w, now));
    }

    /* ------------------------------------------------------------------ layout feedback from the UI */

    /// The window's laid-out box (used by the mouse tendency).
    pub fn set_rect(&mut self, id: WinId, rect: Rect) {
        if let Some(w) = self.get_mut(id) {
            w.rect = Some(rect);
        }
    }

    /// A root window's anchor rectangle as seen this frame. Unfreezes a frozen root whose anchor is back.
    pub fn set_anchor_rect(&mut self, id: WinId, rect: Rect) {
        if let Some(w) = self.get_mut(id) {
            w.anchor_rect = Some(rect);
            w.frozen = false;
        }
    }

    /// Anchors that were not drawn this frame vanished (SPEC §3.5): previews close, pinned roots freeze in
    /// place, pinned children stay with their parent.
    pub fn retain_anchors(&mut self, present: impl Fn(&AnchorId) -> bool) {
        let gone: Vec<WinId> = self.wins.iter().filter(|w| !present(&w.anchor)).map(|w| w.id).collect();
        for id in gone {
            let Some(w) = self.get(id) else { continue };
            if !w.pinned {
                self.close(id);
            } else if w.parent.is_none() {
                if let Some(w) = self.get_mut(id) {
                    w.frozen = true;
                }
            }
        }
    }

    /* ------------------------------------------------------------------ time */

    /// Run every timer that is due at `now` (ms), in time order. Returns when the next timer is due, so the UI
    /// can schedule a repaint.
    pub fn tick(&mut self, now: f64) -> Option<f64> {
        for _ in 0..1000 {
            let Some(next) = self.next_due() else { break };
            if next.at() > now {
                break;
            }
            match next {
                Due::Arm(_) => self.fire(now),
                Due::Leave(id, _) => self.leave_check(id, now),
                Due::Lock(id, _) => {
                    self.lock = None;
                    self.pin(id);
                }
            }
        }
        self.deadline(now)
    }

    fn fire(&mut self, now: f64) {
        let Some(p) = self.pending.clone() else { return };
        if now - p.since < p.delay + TENDENCY_MAX && self.heading_away(p.parent, now) {
            if let Some(p) = &mut self.pending {
                p.fire_at = now + RETRY;
            }
            return;
        }
        self.pending = None;
        self.open(&p.key, p.anchor, p.parent, false, false, Via::Hover, now);
    }

    fn leave_check(&mut self, id: WinId, now: f64) {
        let Some(w) = self.get(id) else { return };
        let Some(leave) = w.leave else { return };
        if w.pinned || self.hot.contains(&id) {
            if let Some(w) = self.get_mut(id) {
                w.leave = None;
            }
            return;
        }
        if now - leave.since < TENDENCY_MAX && self.heading(id, now) {
            if let Some(w) = self.get_mut(id) {
                w.leave = Some(Leave { since: leave.since, check_at: now + RETRY });
            }
            return;
        }
        self.close(id);
    }

    fn next_due(&self) -> Option<Due> {
        let mut best: Option<Due> = self.pending.as_ref().map(|p| Due::Arm(p.fire_at));
        for w in &self.wins {
            if let (Some(l), false) = (w.leave, w.pinned) {
                if best.is_none_or(|b| l.check_at < b.at()) {
                    best = Some(Due::Leave(w.id, l.check_at));
                }
            }
        }
        if let Some((id, since)) = self.lock {
            if self.options.lock_after > 0.0 {
                let at = since + self.options.lock_after;
                if best.is_none_or(|b| at < b.at()) {
                    best = Some(Due::Lock(id, at));
                }
            }
        }
        best
    }

    /// When something next changes: a timer, or the end of a flash animation.
    fn deadline(&self, now: f64) -> Option<f64> {
        let mut at = self.next_due().map(|d| d.at());
        for w in &self.wins {
            if let Some(f) = w.flash_at.map(|f| f + FLASH).filter(|&f| f > now) {
                at = Some(at.map_or(f, |a| a.min(f)));
            }
        }
        at
    }
}

#[derive(Clone, Copy, Debug)]
enum Due {
    Arm(f64),
    Leave(WinId, f64),
    Lock(WinId, f64),
}

impl Due {
    fn at(self) -> f64 {
        match self {
            Self::Arm(t) | Self::Leave(_, t) | Self::Lock(_, t) => t,
        }
    }
}
