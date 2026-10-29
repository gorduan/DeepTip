//! # DeepTip for Rust and egui
//!
//! Explanation windows with depth ("tooltips in tooltips", Paradox style): rest on a widget and a window explains
//! it; highlighted terms inside open further windows on hover; a click pins a window open; pinned windows nest
//! without limit. The contract is `SPEC.md` of the DeepTip repository, the content is a JSON glossary per locale.
//!
//! The crate has a pure core and an egui UI (feature `egui`, on by default):
//!
//! | Module | SPEC | What |
//! |---|---|---|
//! | [`glossary`] | §2 | flattening locale files, layers, the locale chain, `$ui` labels |
//! | [`markup`] | §2.4 | the markup parser (`parse_text`) and its AST |
//! | [`placement`] | §4 | `compute_placement`, the side order of windows |
//! | [`engine`] | §3 | the window tree, hot set, grace, mouse tendency, suppression, arming, timer lock |
//! | `ui` | §3, §5, §6 | egui windows, terms, marked widgets, keyboard and touch (`DeepTip`) |
//!
//! ```no_run
//! # #[cfg(feature = "egui")]
//! # fn frame(ui: &mut egui::Ui, dt: &mut deeptip::DeepTip) {
//! // once: let mut dt = deeptip::DeepTip::new("en", &["en"]);
//! //       dt.set_sources(&["glossary/core/{locale}.json", "deeptip/{locale}.json"]);
//! // every frame:
//! let r = ui.button("Cart");
//! dt.mark(&r, "shop.cart");
//! dt.show(ui.ctx());
//! # }
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod engine;
pub mod glossary;
pub mod markup;
pub mod placement;
#[cfg(feature = "egui")]
pub mod ui;

pub use engine::{AnchorId, Engine, Event, Hover, LinkHover, Options, OutsideClick, TrigHover, Via, WinId, Window};
pub use glossary::{flatten_glossary, is_valid_key, Entry, Flattened, Found, Glossary, LoadError, Problem};
pub use markup::{collect_refs, parse_text, runs, Block, Emphasis, Inline, Refs, Run};
pub use placement::{compute_placement, parse_sides, Placement, Rect, Side, Size, CHILD_SIDES, ROOT_SIDES};
#[cfg(feature = "egui")]
pub use ui::{escape_markup, Action, DeepTip, Look, MarkOptions};

/// Version of this crate (= the DeepTip release it implements).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
