//! Placement (SPEC §4): where a window goes next to its anchor. A port of `computePlacement` in
//! `frameworks/web/deeptip.js`, checked against `test/cases/placement.json`.

/// A side of an anchor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Side {
    /// Left of the anchor.
    Left,
    /// Right of the anchor.
    Right,
    /// Above the anchor.
    Top,
    /// Below the anchor.
    Bottom,
}

impl Side {
    /// `"left"`, `"right"`, `"top"`, `"bottom"`; anything else is `None`.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "top" => Some(Self::Top),
            "bottom" => Some(Self::Bottom),
            _ => None,
        }
    }

    /// The side's name.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Top => "top",
            Self::Bottom => "bottom",
        }
    }

    /// Left or right.
    pub fn is_horizontal(self) -> bool {
        matches!(self, Self::Left | Self::Right)
    }
}

/// Default side order of the first window next to its UI element (`root`).
pub const ROOT_SIDES: [Side; 4] = [Side::Bottom, Side::Top, Side::Right, Side::Left];
/// Default side order of a further window next to the window it came from (`child`).
pub const CHILD_SIDES: [Side; 4] = [Side::Left, Side::Right, Side::Top, Side::Bottom];

/// Parse a list like `["top", "bottom"]` or `"top,bottom"`; unknown names are dropped.
pub fn parse_sides<S: AsRef<str>>(names: &[S]) -> Vec<Side> {
    names.iter().flat_map(|n| n.as_ref().split([',', ' ']).filter_map(Side::parse).collect::<Vec<_>>()).collect()
}

/// A rectangle in pixels (or points), y grows downwards.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    /// Left edge.
    pub left: f64,
    /// Top edge.
    pub top: f64,
    /// Right edge.
    pub right: f64,
    /// Bottom edge.
    pub bottom: f64,
}

impl Rect {
    /// From edges.
    pub fn new(left: f64, top: f64, right: f64, bottom: f64) -> Self {
        Self { left, top, right, bottom }
    }

    /// From position and size.
    pub fn from_xywh(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { left: x, top: y, right: x + w, bottom: y + h }
    }

    /// Width.
    pub fn width(&self) -> f64 {
        self.right - self.left
    }

    /// Height.
    pub fn height(&self) -> f64 {
        self.bottom - self.top
    }

    /// Does the rectangle contain the point (edges included)?
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.left && x <= self.right && y >= self.top && y <= self.bottom
    }

    /// The same rectangle moved by (dx, dy).
    pub fn translate(&self, dx: f64, dy: f64) -> Self {
        Self::new(self.left + dx, self.top + dy, self.right + dx, self.bottom + dy)
    }
}

/// A size.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Size {
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
}

impl Size {
    /// A size.
    pub fn new(w: f64, h: f64) -> Self {
        Self { w, h }
    }
}

/// The result of [`compute_placement`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    /// The side that was taken.
    pub side: Side,
    /// Left edge of the window (gap excluded).
    pub x: f64,
    /// Top edge of the window.
    pub y: f64,
    /// Did the window fit on that side?
    pub fits: bool,
    /// > 0: the window must shrink to this width (nothing fitted, horizontal side).
    pub max_w: f64,
    /// > 0: the window must shrink to this height (nothing fitted, vertical side).
    pub max_h: f64,
}

/// `Math.min` of JavaScript (NaN wins).
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if b < a {
        b
    } else {
        a
    }
}

/// `Math.max` of JavaScript (NaN wins).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if b > a {
        b
    } else {
        a
    }
}

/// Where a window of `size` goes next to the anchor rectangle `a` inside a viewport of `vp` (origin 0,0).
///
/// Tries `sides` in order and takes the first where the window fits between anchor and viewport edge
/// (it never covers the anchor). On the cross axis it is centred on the anchor and pushed back inside the
/// viewport. Nothing fits: the side with the most room relative to the window's size; the window shrinks to
/// that room (`max_w` / `max_h`, at least 120, else it is only kept on screen). An empty `sides` means bottom.
pub fn compute_placement(size: Size, a: Rect, sides: &[Side], vp: Size, gap: f64) -> Placement {
    let room = |s: Side| match s {
        Side::Left => a.left - 2.0 * gap,
        Side::Right => vp.w - a.right - 2.0 * gap,
        Side::Top => a.top - 2.0 * gap,
        Side::Bottom => vp.h - a.bottom - 2.0 * gap,
    };
    let need = |s: Side| if s.is_horizontal() { size.w } else { size.h };
    let order: Vec<Side> = if sides.is_empty() { vec![Side::Bottom] } else { sides.to_vec() };
    let first_fit = order.iter().copied().find(|&s| room(s) >= need(s));
    let fits = first_fit.is_some();
    let mut max_w = 0.0;
    let mut max_h = 0.0;
    let side = match first_fit {
        Some(s) => s,
        None => {
            let mut best = order[0];
            for &s in &order[1..] {
                if room(s) / need(s) > room(best) / need(best) {
                    best = s;
                }
            }
            if room(best) >= 120.0 {
                if best.is_horizontal() {
                    max_w = room(best);
                } else {
                    max_h = room(best);
                }
            }
            best
        }
    };
    let w = if max_w != 0.0 { js_min(size.w, max_w) } else { size.w };
    let h = if max_h != 0.0 { js_min(size.h, max_h) } else { size.h };
    let clamp = |v: f64, lo: f64, hi: f64| js_max(lo, js_min(v, js_max(lo, hi)));
    let aw = a.right - a.left;
    let ah = a.bottom - a.top;
    let (mut x, mut y);
    if side.is_horizontal() {
        x = if side == Side::Left { a.left - gap - w } else { a.right + gap };
        y = a.top + ah / 2.0 - h / 2.0;
    } else {
        y = if side == Side::Top { a.top - gap - h } else { a.bottom + gap };
        x = a.left + aw / 2.0 - w / 2.0;
    }
    x = clamp(x, gap, vp.w - gap - w);
    y = clamp(y, gap, vp.h - gap - h);
    Placement { side, x, y, fits, max_w, max_h }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse() {
        assert_eq!(parse_sides(&["top,bottom", "middle", "left"]), vec![Side::Top, Side::Bottom, Side::Left]);
    }

    #[test]
    fn never_covers_the_anchor() {
        let a = Rect::new(100.0, 100.0, 400.0, 400.0);
        let p = compute_placement(Size::new(300.0, 200.0), a, &CHILD_SIDES, Size::new(1000.0, 800.0), 8.0);
        assert_eq!(p.side, Side::Right);
        assert!(p.x >= a.right);
    }
}
