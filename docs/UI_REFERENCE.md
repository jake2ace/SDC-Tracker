# Interface reference: Midday

Reviewed on 24 October 2026. The two supplied links both identify
[`midday-ai/midday`](https://github.com/midday-ai/midday), inspected at
`51587319f26a0ffaa9dfccab1920373cb65689b7`, alongside its public website.

## Patterns applied to Milestone2Cash

- A clear editorial headline followed by a large, interactive product preview.
- Neutral light and dark surfaces, fine borders, restrained status colours and compact metrics.
- Clickable summaries that lead to work, and an invoice list with search and filters.
- Invoice details stay beside the list; filtering does not silently change the selected invoice.
- Visible, persistent appearance choices and keyboard access to invoice search.

The implementation uses our existing React components, workspace data, routes and
permission checks. Financial values in the workspace come from its data; the public
preview is explicitly a synthetic illustration. Midday's source code, branding,
screenshots and product claims are not included.

## Preview entry points

- `/` always opens the public website, including after a previous demo visit.
- `/#/home` opens the workspace overview; `/#/invoices` opens invoice search.
- The workspace brand links back to the website without changing the selected
  demo identity or appearance. Website section anchors remain on the website.

These are navigation choices for the synthetic demo, not authentication routes.
Existing backend role and company checks continue to apply to workspace actions.

## Reference entry points

- [Public website](https://midday.ai)
- [Dashboard sidebar](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/sidebar.tsx)
- [Invoice filters](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/invoice-search-filter.tsx)
- [Theme tokens](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/ui/src/globals.css)
