# Vertical Timeline

## Purpose

The home page uses a vertical timeline rail on the right side to jump across the gallery by date while keeping the gallery itself in an infinite-scroll layout.

## Behavior

- The rail is fixed beside the gallery and does not scroll with the gallery cards.
- Each tick represents a 5-day bucket.
- Each tick is 5px tall.
- Ticks with media are blue.
- Ticks without media are gray.
- The first bucket of each month becomes a longer tick and shows a month label.
- Months with no media are omitted automatically because the source date API only returns months that have at least one asset.
- A red ruler stays at the vertical center of the rail and represents the currently selected bucket.

## Data source

- The rail reads from `/api/dates`.
- Raw per-day counts are compacted in the frontend into 5-day buckets.
- The gallery date and the timeline date both use the same effective timestamp logic:
  `taken_at` first, earliest resource `mtime` as fallback.

## Interaction

- Mouse wheel scrolls the rail vertically.
- Left-button drag moves the rail vertically.
- Clicking a tick jumps the gallery to the page chunk that contains the nearest matching date.
- The `跳转` button jumps to the bucket currently aligned with the red ruler.
- When the gallery scrolls, the rail recenters to the date of the first visible card.

## Rendering notes

- The rail is independent from the gallery DOM.
- The gallery loads in page-sized chunks through `/api/groups`.
- Each loaded chunk is rendered as one section with a horizontal divider.
- Month dividers are inserted inside the gallery stream whenever the month changes.
