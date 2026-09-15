# Metflux UI Redesign Prompt

Use this document as the design and implementation brief when improving any remaining page in the Metflux admin application.

## Product context

Metflux is a manufacturing ERP for transformer and magnetic-core production. The application is used by administrators, managers, and staff to manage sales orders, quotations, production, testing, packing, dispatch, inventory, suppliers, customers, payments, and operational reporting.

The interface must feel like a dependable professional operations system: calm, precise, fast to scan, and easy to operate for long periods. It should look modern and premium without becoming decorative or difficult to use.

## Visual direction

Create a modern glass-effect interface based on the existing Dashboard and Production UI.

- Use a soft neutral background with subtle brand-colored radial lighting.
- Use translucent white or dark panels with a restrained glass effect, gentle blur, fine borders, and soft layered shadows.
- Keep brand colors dynamic. Read the existing `--brand-*` CSS variables; do not hard-code Metflux green or Toroflux navy.
- Use the active brand color for primary actions, selected states, progress, links, and important highlights.
- Use semantic colors consistently: green for healthy or completed states, amber for pending or attention, red for destructive or rejected states, and blue for informational states.
- Keep surfaces quiet. Avoid excessive gradients, saturated backgrounds, thick borders, and large decorative illustrations.
- Use generous whitespace and a clear visual hierarchy. The most important information should be visible before secondary details.

## Typography

Use the application’s existing Inter-based font stack.

- Page title: 24–30px, weight 650, tight letter spacing.
- Section title: 16–18px, weight 650.
- Body text: 14px, line-height 1.45–1.6.
- Supporting text: 12–13px with readable contrast.
- Table headers: 10–11px, uppercase, weight 700–750, letter spacing around 0.06–0.08em.
- Numbers: use the existing `.font-num` class or equivalent tabular numerals. Numeric columns must align vertically.
- Do not use tiny 10px body text for important values, names, dates, prices, quantities, or table content.
- Maintain strong contrast in both light and dark modes.

## Layout rules

- Use a consistent page shell with a clear title row, optional primary action, filters, content surface, and footer/pagination.
- Use rounded panels around 16–22px on modern pages. Use smaller 8–12px rounding for controls, chips, and compact elements.
- Keep content width efficient. Do not stretch dense tables unnecessarily across the entire screen.
- Tables may scroll horizontally on smaller screens, but the page itself must never create accidental horizontal overflow.
- Prefer responsive stacked cards on mobile when a table has many columns.
- Keep primary actions visible and easy to reach. Use descriptive labels when space allows and icon-only controls only with accessible labels/tooltips.
- Preserve existing routes, permissions, query behavior, validation, and business logic.

## Standard page structure

Use this structure when it fits the page:

1. Page header
   - Clear title and a small contextual subtitle.
   - Relevant icon inside a small brand-tinted icon tile.
   - Primary action on the right, such as “New Sales Order”, “Record Production”, or “Add Customer”.

2. Filter and search toolbar
   - Search field with a search icon and useful placeholder.
   - Date range, status, customer, worker, or category filters as appropriate.
   - Selected filters should be obvious.
   - Include a clear/reset action when multiple filters are present.

3. Summary strip or insight cards
   - Show only metrics useful for the current page.
   - Use short labels, large readable values, and a supporting description.
   - Use tabular numerals and semantic accent colors.

4. Main content surface
   - Use a titled surface for complex tables or forms.
   - Include a short explanation of what the table represents.
   - Keep headers visible while scrolling when practical.

5. Pagination and status feedback
   - Keep pagination visually attached to the table.
   - Show the current range and total count.
   - Provide clear loading, empty, error, and success states.

## Table design

Apply this to all tabular pages, including sales orders, quotations, production, testing, packing, suppliers, customers, ledgers, and reports.

- Use a pale tinted header row with high-contrast uppercase labels.
- Use 14px table text and 13–14px supporting values.
- Use 14–15px for important names and primary numeric values.
- Increase row padding to approximately 14–16px vertically.
- Use subtle horizontal dividers rather than heavy boxes around every cell.
- Highlight rows on hover with a very light brand tint.
- Use a stronger background and a left accent edge for group or parent rows.
- Make expanded rows visibly different from collapsed rows.
- Use badges for status and type. Badges should be compact, readable, and semantically colored.
- Right-align quantities, weights, rates, totals, and currency.
- Keep dates and identifiers aligned and easy to compare.
- Use action buttons with at least a 34px hit area, rounded corners, and accessible labels.
- Add `aria-label`, `aria-expanded`, and keyboard behavior to expand/collapse controls.
- Use a sticky table header inside long scrolling surfaces.
- Keep export, edit, print, convert, delete, and restore actions visually distinct.

## Forms and workflows

- Group related fields into clear sections instead of presenting one uninterrupted field list.
- Use labels above inputs, not placeholder-only labels.
- Use 40–44px control height for normal fields.
- Use visible focus rings and clear disabled states.
- Show calculated values in a highlighted summary card.
- For multi-step workflows, show progress with numbered steps and a clear active step.
- Keep save/submit actions persistent and easy to find.
- Explain irreversible or consequential actions before the user confirms them.
- Preserve drafts, validation, loading states, and existing confirmation dialogs.

## Motion

Use animation to communicate state and hierarchy, not as decoration.

- Fade and lift page surfaces into place with a short 400–700ms entrance.
- Animate metric values when they change.
- Animate progress bars from zero to their actual width.
- Animate charts drawing into view.
- Animate hover states subtly with transform, shadow, or border color.
- Animate expand/collapse where it improves understanding.
- Add a motion pause control for animated dashboards or dense operational screens when useful.
- Always respect `prefers-reduced-motion: reduce` and remove non-essential animation.
- Never delay access to data or controls for an animation.

## States that must be designed

Every page must have a polished version of these states:

- Loading: use a calm skeleton or centered spinner without shifting the layout.
- Empty: explain what is empty and provide the next useful action.
- Error: explain that data could not load and preserve the last available data when safe.
- Filtered empty: explain that filters produced no results and offer a clear/reset action.
- Disabled action: explain why the action is unavailable when the reason is not obvious.
- Success: show a concise confirmation without blocking the next operation.

## Accessibility and usability

- Preserve semantic headings and table structure.
- Ensure all controls are keyboard accessible.
- Add labels to icon-only controls.
- Maintain visible focus states.
- Do not communicate status using color alone.
- Ensure text remains readable over translucent surfaces.
- Use adequate touch targets on mobile.
- Keep important actions and information discoverable without hover.

## Existing design references

Use these files as the implementation references already present in the project:

- Dashboard page: `client/src/pages/DashboardPage.tsx`
- Dashboard glass styling: `client/src/components/dashboard/glass.css`
- Dashboard theme tokens: `client/src/components/dashboard/theme.ts`
- Shared dashboard components: `client/src/components/dashboard/ui.tsx`
- Production styling: `client/src/components/production/workspace.css`
- Production shared components: `client/src/components/production/erp.tsx`
- Sales register styling: `client/src/components/sales-tables.css`

## Pages to improve next

Apply the same design language to the remaining pages, prioritizing dense operational screens:

- Testing calculator and testing report
- Packing and packing list
- Dispatch list and dispatch creation/edit screens
- Warehouse and materials
- Suppliers and supplier orders
- Customers and customer forms
- Payments, cashbook, ledgers, aging, and reconciliation
- Notifications and audit logs
- Company, branding, and settings pages

## Implementation constraints

- This is a UI redesign only. Do not change API contracts, calculations, database behavior, permissions, or business rules unless explicitly requested.
- Keep existing routes and deep links working.
- Reuse existing components and tokens before creating new ones.
- Prefer scoped CSS classes for page-specific design changes.
- Do not add large UI libraries when existing React, Tailwind, Lucide, and project components are sufficient.
- Verify TypeScript compilation and the production client build after changes.
- Check desktop and mobile layouts with realistic data.
- Check light and dark modes when the page supports them.
- Do not leave temporary preview files, debug code, mock data, or console logging in the final implementation.

## Prompt for a UI tool

> Redesign the selected Metflux admin page using the project’s existing Dashboard, Production, and sales-register UI language. Make it modern, professional, highly readable, and operationally efficient. Use the existing Inter font stack, dynamic `--brand-*` CSS variables, translucent glass panels, subtle brand lighting, rounded surfaces, soft shadows, clear table hierarchy, tabular numerals, accessible controls, responsive mobile layouts, and restrained purposeful animation. Preserve all existing data, routes, permissions, API calls, calculations, validation, and user actions. Improve the page title area, search and filter toolbar, summary metrics, main table or form, pagination, loading state, empty state, error state, action buttons, keyboard accessibility, and mobile presentation. Use larger readable text for names and values, right-align numeric columns, add sticky table headers for long lists, and make group rows and status badges easy to scan. Respect reduced-motion preferences. Finish with a production-ready implementation and verify the TypeScript build and responsive layout.
