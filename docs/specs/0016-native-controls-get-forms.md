# 0016. Native controls in GET forms

**Date**: 2026-10-19
**Status**: Accepted

## Summary

Every GET form (a form that only changes the page URL, such as a filter, a period picker or a search box) uses native browser controls: `NativeSelect` for a select, `<input type="checkbox">` and `<input type="radio">` for the rest, and a real submit button. That way the form works before the app's JavaScript loads, and still works if it fails to load. The Base UI Select is banned by a lint rule, because it is a button that only opens with JavaScript. The three admin filters and the hand rolled native selects move over in one change, and each GET form gets one e2e test with the app's scripts blocked.

## Context

Spec 0003 made the Base UI flavour of shadcn the component set, with `Select`, `Checkbox` and `RadioGroup` among the core components. These are buttons and spans with ARIA roles. The real form value lives in a hidden input that only their JavaScript can change. In a POST form built with React Hook Form that is fine, because the form needs JavaScript anyway. In a GET form it is not. Until the bundles load (a slow phone network, a cold start) or if they fail, the control is dead. The form still submits, but always with the value the page was rendered with.

This already caused a shipped bug. The dashboard's period picker (spec 0015, AC-3, "works without JavaScript") used the Base UI Select. Without JavaScript the preset could not be changed, and Apply sent the same period again. It was fixed on 2026-10-19 with a native select. The storefront had met the same problem earlier and solved it locally: spec 0013's sort is a native select, with a comment saying the Base UI Select needs JavaScript. Nothing written down carried that lesson to the next form.

Today the codebase has two competing patterns in GET forms:
- **Base UI controls**: the orders list filters (`orders-filters.tsx`: Status, Refund and Date selects, plus the "Needs attention only" Checkbox), the discount codes Status filter (`status-filter.tsx`) and the products Category filter (`category-filter.tsx`). All four are dead before hydration (the moment React takes over the server HTML).
- **Hand rolled native controls**: the storefront sort (`sort-select.tsx`), the dashboard period picker (`period-picker.tsx`), the storefront filter panel checkboxes (`filter-panel.tsx`), and the checkout saved addresses select (`checkout-form.tsx`, a POST form; the country is shown as text, not a select). Each one styles its own `<select>` with slightly different classes.

Admin sign in and TOTP already need JavaScript (React Hook Form), so an admin can't reach the panel with JavaScript turned off. In admin, "works without JavaScript" really means "works before the bundles load, and when they fail". That is still worth having on list pages an admin opens many times a day, and it costs almost nothing.

## Options considered

### Option 1: Standard, lint ban, single migration change

Define the rule, ban the Base UI Select import with ESLint, add the shadcn `native-select` component, and move every existing GET form and hand rolled select over in one change. Each GET form gets one e2e test with the app's scripts blocked.

**Pros**:
- The rule is true on day one, and the lint rule stops the Select from coming back (it fails in the pre commit hook and in CI).
- One styled `NativeSelect` ends the drift between the hand rolled selects.
- The e2e tests catch the controls lint can't see (Checkbox and RadioGroup, which POST forms still use).

**Cons**:
- One change touches four features (orders, discounts, catalog, dashboard) plus checkout, and the e2e tests that open these selects by clicking need rewriting.
- A native select's open list is drawn by the browser, so it can't be styled like the Base UI popup.

### Option 2: Standard and lint ban for new code only

Same rule and lint ban, but the existing Base UI filters stay, each with an ESLint disable comment, tracked as debt.

**Pros**:
- No migration now, so no risk to the existing admin e2e suites.

**Cons**:
- The orders, discounts and products filters stay dead before hydration, so the rule is false where admins use it most.
- Disable comments on day one teach that the rule is optional.

### Option 3: Document only

Write the rule in `AGENTS.md` and rely on review.

**Pros**:
- No tooling and no migration.

**Cons**:
- This is exactly how the period picker slipped through: the lesson already existed as a comment in `sort-select.tsx`, and nobody saw it.

### Option 4: Remove the Base UI Select entirely

Delete `src/components/ui/select.tsx` and its style guide section.

**Pros**:
- The strictest enforcement: nothing to import.

**Cons**:
- It edits spec 0003's component set and its style guide AC, and it removes the richer select a future JavaScript only form (a searchable picker in an editor) could rightly use.

## Decision

**Chosen option**: Option 1: Standard, lint ban, single migration change

Every GET form uses native controls (`NativeSelect`, native checkbox and radio) plus a submit button. ESLint bans `@/components/ui/select` outside the style guide, and every existing violation and hand rolled select moves over in one change, each GET form proven by an e2e test with the app's scripts blocked.

**Implementation skills**: `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `playwright-best-practices` (installed in the user's skills, not in `AGENTS.md`)

## Rationale

The force that decides this is that the failure is silent. A dead Base UI control looks normal, the form submits, the page reloads, and the admin just sees the same results. No error is logged anywhere. So a rule that relies on people noticing (Option 3) has already failed once. A lint rule is the strongest check that fits, and a check per form in e2e covers what lint can't tell apart (a Checkbox is fine in a POST editor and wrong in a GET filter).

Migrating everything at once (Option 1 over Option 2) is the better choice because the blast radius is small and well known: four GET forms, three hand rolled selects, all list pages with existing e2e tests. Leaving them as debt would keep the bug on the pages admins use most (orders), and would start the rule off with disable comments. Keeping the Base UI Select in the codebase (over Option 4) leaves room for a future JavaScript only control without reopening spec 0003. The lint ban already gives nearly all the protection of deleting it.

`NativeSelect` comes from the official shadcn registry (`native-select`, available for this project's `base-vega` style). It reuses the project's tokens and focus ring, so it matches the inputs beside it and ends the drift between the hand rolled copies. The native checkbox needs no new component. One `<input type="checkbox">` with the classes the storefront filter panel already uses is simpler than a wrapper.

## Standard definition

**What counts as a GET form**: a `<form>` with no `method`, or `method="get"`, whose submit only changes the URL query (filters, period pickers, search boxes). POST forms (server actions, React Hook Form editors, sign in) are outside this standard.

**Canonical pattern**:
```tsx
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

// spec 0016: a GET form works before the app's JavaScript loads, so its controls are native.
<form aria-label="Find orders" action={adminOrdersPath} className="flex flex-wrap items-end gap-3">
  <div className="flex flex-col gap-2">
    <Label htmlFor="orders-status">Status</Label>
    <NativeSelect id="orders-status" name="status" defaultValue={params.status} className="w-44">
      {statusItems.map((item) => (
        <NativeSelectOption key={item.value} value={item.value}>
          {item.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  </div>
  <div className="flex h-9 items-center gap-2">
    <input
      type="checkbox"
      id="orders-attention"
      name="attention"
      value="1"
      defaultChecked={params.attention}
      className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
    />
    <Label htmlFor="orders-attention">Needs attention only</Label>
  </div>
  <Button type="submit" variant="outline">Find orders</Button>
</form>
```

Rules the pattern carries:
- **Select**: `NativeSelect` with `NativeSelectOption`, always with a `name` and a `<Label htmlFor>`.
- **Checkbox and radio**: native `<input type="checkbox">` / `<input type="radio">` with the classes above and a `<Label htmlFor>`. A radio group sits in a `<fieldset>` with a `<legend>`.
- **Uncontrolled by default**: use `defaultValue` / `defaultChecked`. Make a control controlled (`value` plus `onChange`) only when JavaScript behaviour needs the state, such as the period picker clearing its dates when you pick a preset. Then the native control still works on its own before hydration.
- **Submit button**: every GET form has a real `<button type="submit">`. A form that applies changes at once with JavaScript may hide it while JavaScript runs (spec 0013's filter panel). Admin forms and the dashboard picker keep it visible, as they do today.
- **Reading the value in e2e**: assert a native select with `toHaveValue`, never `toContainText` (its text holds every option label).

**Replaces**:
- The Base UI `Select` (`@/components/ui/select`) in any form.
- The Base UI `Checkbox` and `RadioGroup` in a GET form.
- Hand rolled `<select>` elements with their own classes (`sort-select.tsx`, `period-picker.tsx`, `checkout-form.tsx`).

**Enforcement**:
- **ESLint** (`eslint.config.mjs`): `no-restricted-imports` with `paths: [{ name: "@/components/ui/select", message: "Use NativeSelect from @/components/ui/native-select (spec 0016): the Base UI Select only opens with JavaScript." }]`, plus an override that turns the rule off for `src/features/style-guide/**`. It runs in `pnpm lint`, the pre commit hook and the CI `static` job.
- **E2e**: a shared `blockAppScripts(page)` helper in `tests/e2e/no-js.ts` aborts `/_next/static/chunks/*.js` (the pattern from specs 0013 and 0015). Every GET form has one test that blocks the scripts, changes each of its selects, checkboxes and radios, presses the submit button, and checks the URL query. This catches a Base UI Checkbox or RadioGroup, which lint allows because POST forms use them.

**Rollout**: one migration change.
1. `pnpm dlx shadcn@latest add native-select`, then review it as the `shadcn` skill says. Add a `NativeSelect` section with its default, focus, disabled and invalid states to `/style-guide`, next to the Base UI Select it stays beside.
2. Move to `NativeSelect` and native checkboxes: `orders-filters.tsx` (Status, Refund, Date, and the "Needs attention only" checkbox), `status-filter.tsx`, `category-filter.tsx`, `period-picker.tsx`, `sort-select.tsx` and the checkout saved addresses select in `checkout-form.tsx`. Keep each control's `id`, `name` and label, so URLs and accessible names don't change.
3. Add `blockAppScripts` and one no JavaScript test per GET form: admin orders, admin discounts, admin products, the category page's "Find products to add" search, the dashboard picker, and the storefront filter panel and search box. Move the existing tests in `tests/e2e/catalog/discovery.spec.ts` and `tests/e2e/admin/dashboard.spec.ts` onto the helper.
4. Update the e2e tests that open these selects by clicking the combobox and an option. They switch to `selectOption` and `toHaveValue` (for example the orders "Date" check in `dashboard.spec.ts`).
5. Add the ESLint ban last, so the change lands with lint clean.

**Exceptions**:
- The style guide (`src/features/style-guide/`) keeps showing the Base UI Select, as spec 0003 requires.
- A future POST form that needs JavaScript anyway may use the Base UI Select, with an `eslint-disable-next-line no-restricted-imports` comment that names the reason. A GET form has no exceptions.

## Consequences

**Positive**:
- Every filter, picker and search box works before the bundles load and when they fail, so the period picker bug can't come back in another form.
- One `NativeSelect` replaces three differently styled hand rolled selects.
- On phones, a native select opens the system picker, which people already know how to use.

**Negative / tradeoffs**:
- The open option list is drawn by the browser, so it can't match the Base UI popup's look (no custom item layout, icons or search inside the list).
- The rule has two layers: lint covers the Select, but a Base UI Checkbox in a new GET form is only caught by its e2e test, so a GET form without that test can slip through.
- The migration rewrites e2e steps in several suites at once, and while it is in review it can conflict with other work on those files.

**Neutral**:
- Spec 0003's component set stays as it is. `native-select` is added beside `select`, which stays for the style guide and JavaScript only forms.
- Spec 0013's storefront Apply behaviour (shown only without JavaScript) and spec 0015's always visible Apply both stay valid under this standard.

## Follow-up

- [ ] Run the migration change in the Rollout above (no scope row is linked; `/scope` can enroll it as a small feature).
- [ ] Record the rule in root `AGENTS.md` `## Rules` (the UI line) and `native-select` in the component set, through `/sync` after the migration lands.
- [ ] `playwright-best-practices` is installed in the user's skills but not listed in root `AGENTS.md` `## Agent skills`; it applies to every e2e suite, so it belongs at root level.
