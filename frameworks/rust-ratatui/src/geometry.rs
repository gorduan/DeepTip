//! Cells and placement: the terminal grid mapped onto the pixels of the reference.
//!
//! DeepTip's constants are pixels (gap 8, minimum shrink 120, tendency padding 12, window width 240–384 …).
//! The adapter gives every cell a nominal pixel size, 8 × 16 by default (a terminal cell is about twice as tall as
//! it is wide). Then every constant keeps its meaning: the gap is one column, a window shrinks into a side only
//! with at least 15 columns or 8 rows of room, and the core's `compute_placement` runs unchanged. Results are turned
//! back into cells by rounding away from the anchor on the side's axis and down on the other axis, then clamped
//! into the screen.

use deeptip::{compute_placement, Rect as PxRect, Side, Size};
use ratatui::layout::Rect;

/// The default nominal size of one terminal cell in pixels: (width, height).
pub const CELL: (f64, f64) = (8.0, 16.0);

/// A cell rectangle in nominal pixels (what the core's engine and placement expect).
pub fn rect_px(r: Rect, cell: (f64, f64)) -> PxRect {
    PxRect::new(
        f64::from(r.x) * cell.0,
        f64::from(r.y) * cell.1,
        (f64::from(r.x) + f64::from(r.width)) * cell.0,
        (f64::from(r.y) + f64::from(r.height)) * cell.1,
    )
}

/// The centre of a cell in nominal pixels (pointer samples for the mouse tendency).
pub fn centre_px(x: u16, y: u16, cell: (f64, f64)) -> (f64, f64) {
    ((f64::from(x) + 0.5) * cell.0, (f64::from(y) + 0.5) * cell.1)
}

/// Where a window goes, in cells (see [`place_in_cells`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellPlacement {
    /// The side that was taken.
    pub side: Side,
    /// Left column of the window (absolute, like the viewport).
    pub x: u16,
    /// Top row of the window.
    pub y: u16,
    /// Did the window fit on that side?
    pub fits: bool,
    /// > 0: nothing fitted and the window must shrink to this many columns.
    pub max_w: u16,
    /// > 0: nothing fitted and the window must shrink to this many rows.
    pub max_h: u16,
}

/// `computePlacement` (algorithms §8) in terminal cells: a window of `width` × `height` cells next to `anchor`
/// inside `viewport` (both absolute cell rectangles, e.g. `frame.area()`), trying `sides` in order.
///
/// The cells are converted into nominal pixels (`cell`), placed with the core's `compute_placement` and `gap`
/// (pixels, 8 by default), and converted back: the coordinate on the side's axis is rounded away from the anchor
/// (right and bottom up, left and top down), the other one down; then the window is clamped into the viewport.
/// A window that fits therefore never covers its anchor.
pub fn place_in_cells(
    width: u16,
    height: u16,
    anchor: Rect,
    sides: &[Side],
    viewport: Rect,
    cell: (f64, f64),
    gap: f64,
) -> CellPlacement {
    let (cw, ch) = cell;
    // relative to the viewport, whose origin is (0, 0) for the core
    let ax = f64::from(anchor.x) - f64::from(viewport.x);
    let ay = f64::from(anchor.y) - f64::from(viewport.y);
    let a = PxRect::new(ax * cw, ay * ch, (ax + f64::from(anchor.width)) * cw, (ay + f64::from(anchor.height)) * ch);
    let vp = Size::new(f64::from(viewport.width) * cw, f64::from(viewport.height) * ch);
    let p = compute_placement(Size::new(f64::from(width) * cw, f64::from(height) * ch), a, sides, vp, gap);
    let fx = p.x / cw;
    let fy = p.y / ch;
    let x = if p.side == Side::Right { fx.ceil() } else { fx.floor() };
    let y = if p.side == Side::Bottom { fy.ceil() } else { fy.floor() };
    let x = (x.max(0.0) as u16).min(viewport.width.saturating_sub(width));
    let y = (y.max(0.0) as u16).min(viewport.height.saturating_sub(height));
    CellPlacement {
        side: p.side,
        x: viewport.x + x,
        y: viewport.y + y,
        fits: p.fits,
        max_w: (p.max_w / cw).floor().max(0.0) as u16,
        max_h: (p.max_h / ch).floor().max(0.0) as u16,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deeptip::{CHILD_SIDES, ROOT_SIDES};

    #[test]
    fn below_a_button_with_one_row_of_air() {
        let vp = Rect::new(0, 0, 100, 30);
        let button = Rect::new(10, 0, 8, 1);
        let p = place_in_cells(40, 8, button, &ROOT_SIDES, vp, CELL, 8.0);
        assert_eq!(p.side, Side::Bottom);
        assert!(p.fits);
        assert_eq!(p.y, 2, "gap 8 px = half a row, rounded away from the button");
        // centred on the button (14), pushed inside the screen: 14 - 20 < 1 → column 1
        assert_eq!(p.x, 1);
    }

    #[test]
    fn a_child_sits_one_column_beside_its_parent() {
        let vp = Rect::new(0, 0, 120, 30);
        let parent = Rect::new(2, 2, 40, 10);
        let p = place_in_cells(40, 8, parent, &CHILD_SIDES, vp, CELL, 8.0);
        assert_eq!(p.side, Side::Right);
        assert_eq!(p.x, 43);
        assert!(p.y >= 2);
    }

    #[test]
    fn shrinks_to_the_room_of_the_best_side() {
        // 80 columns: right of the parent are 80 - 42 - 2 = 36 columns, the child wants 48
        let vp = Rect::new(0, 0, 80, 14);
        let parent = Rect::new(2, 1, 40, 12);
        let p = place_in_cells(48, 10, parent, &CHILD_SIDES, vp, CELL, 8.0);
        assert!(!p.fits);
        assert_eq!(p.side, Side::Right);
        assert_eq!(p.max_w, 36);
    }
}
