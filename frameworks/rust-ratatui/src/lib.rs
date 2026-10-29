//! # DeepTip for Ratatui
//!
//! Explanation windows with depth ("tooltips in tooltips", Paradox style) in a terminal: rest the mouse on an
//! element (or focus it and press `F1` or `?`) and a box explains it; highlighted terms inside open further boxes
//! beside it; a click pins a box; pinned boxes nest without limit. The contract is `SPEC.md` of the DeepTip
//! repository, the content is a JSON glossary per locale.
//!
//! This crate is an adapter: the glossary, the markup parser, the placement and the whole window tree with its
//! timers come from the pure core of the Rust implementation (crate `deeptip` in `frameworks/rust-egui`, used
//! without its egui feature). The adapter adds what is specific to a terminal:
//!
//! | Module | What |
//! |---|---|
//! | `geometry` | the cell grid mapped onto the reference's pixels (8 × 16 per cell), placement in cells |
//! | `layout` | markup → wrapped lines of cells with the position of every term fragment |
//! | `tui` | [`DeepTip`]: marking, drawing the windows into a ratatui `Buffer`, crossterm events, focus |
//!
//! ```no_run
//! use std::time::Duration;
//! use deeptip_ratatui::DeepTip;
//! use ratatui::crossterm::event;
//! use ratatui::layout::Rect;
//!
//! let mut dt = DeepTip::new("en", &["en"]);
//! dt.set_sources(&["glossary/core/{locale}.json", "deeptip/{locale}.json"]);
//! let mut terminal = ratatui::init();
//! loop {
//!     terminal.draw(|f| {
//!         let cart = Rect::new(2, 1, 8, 1);
//!         f.buffer_mut().set_string(cart.x, cart.y, "[ Cart ]", ratatui::style::Style::default());
//!         dt.mark(cart, "shop.cart"); // rest on it, or focus it and press F1
//!         dt.render(f); // the windows, last
//!     })?;
//!     if event::poll(dt.timeout().unwrap_or(Duration::from_millis(500)))? {
//!         let ev = event::read()?;
//!         if !dt.handle_event(&ev) { /* your own handling */ }
//!     }
//! }
//! # Ok::<(), std::io::Error>(())
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod geometry;
mod layout;
mod tui;

/// The pure core this adapter builds on (glossary, markup, placement, window tree).
pub use deeptip as core;
pub use deeptip::{parse_sides, AnchorId, Engine, Event, Glossary, Options, OutsideClick, Side, Via, WinId, Window};
pub use geometry::{place_in_cells, CellPlacement, CELL};
pub use tui::{
    escape_markup, Action, DeepTip, Focus, IndexState, Look, MarkOptions, MarkState, Symbols, TermInfo, ANIMATION,
    ESC_REPEAT,
};

/// Version of this crate (= the DeepTip release it implements).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
