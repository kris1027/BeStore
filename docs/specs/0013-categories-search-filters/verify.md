# Verify: categories, search & filters · spec 0013 · updated 2026-10-16
_Steps derived from spec 0013 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open a visible category from the header nav → its name, plain text description and its products as cards in `product_categories.position` order → AC-1
- [ ] Visit `/categories/nope`, `/categories/Not_A_Slug` and a hidden category's slug → the store's 404 page; draft, archived and products with only archived variants never appear in any listing → AC-2
- [ ] Header nav lists visible categories in admin order on desktop and in the mobile menu; hide every category → no nav and no "Open menu" button → AC-3
- [ ] A visible category with no listable products → name, description (nothing when empty), "Nothing here yet", a "See all products" link, no filter panel → AC-3
- [ ] `/` lists every listable product (more than 48 when the catalog has them) with filters, sort and paging → AC-4
- [ ] With more than 24 products: 24 per page, `nav[aria-label=Pagination]`, current page `aria-current="page"`, first/last/±1 with an ellipsis, page 1 has no `page` param, no Previous on page 1, no Next on the last, no nav with one page → AC-5
- [ ] Header search box labelled "Search products": inline on desktop, behind a "Search" button on mobile; submits as GET to `/search?q=`; `/search` shows its own box prefilled; a 150 emoji query is cut to 100 whole characters → AC-6
- [ ] Search `kosciol` finds "Kościół", `blu tee` finds "Blue Tee", `TEE` finds "Tee", `tee` does not find "Settee" → AC-7
- [ ] Search `t-shirt` with "Long Sleeve T Shirt" and "T Shirt" present → "T Shirt" first → AC-8
- [ ] `/search`, `/search?q=t`, `/search?q=!!` → "Type at least 2 characters to search", no results, no filters → AC-9
- [ ] Search a few times while watching the server log → no log line contains the query and none is written per search or listing view → AC-10
- [ ] A listing whose filters leave 0 results still shows Price (Min, Max), every option group, "In stock only" and "On sale only" → AC-11
- [ ] Product with Red S (sold out) and Blue M: Red + M excludes it, Red + S includes it, Red + S + In stock only excludes it; a product without Color never matches a Color filter → AC-12
- [ ] Products using "Colour", "colour " and "COLOUR" show one group labelled with the most common spelling; a single value group is hidden; an option named "Sort" is never offered → AC-13
- [ ] With Color = Red on, the Color counts ignore the Red selection, other groups' counts apply it; a count 0 value is disabled unless selected → AC-14
- [ ] Min and Max are labelled with the store currency, accept `0`, show the scope's lowest and highest price as placeholders; typing `abc` and leaving the box empties it → AC-15
- [ ] Sort by offers Featured, Newest, Price low to high, Price high to low, Name A to Z (plus Best match on `/search`, its default); the default never appears in the URL → AC-16
- [ ] Apply filters and a sort, copy the URL into a fresh private window → identical results; reorder the same params by hand → the same canonical links; any change drops `page` → AC-17
- [ ] `/categories/<slug>?min=50&max=10&page=999&sort=zzz&color=nope` → 200, last page, range swapped (chips Min 10, Max 50), Featured, no Color chip → AC-18
- [ ] With JavaScript: checkboxes and sort apply at once, prices on blur or Enter, no full reload, Back undoes the last change; with the app bundles blocked the panel shows Apply and submits as GET → AC-19
- [ ] Desktop sidebar; on a phone a "Filters (n)" button opens a Sheet that stays open and keeps focus while changes apply; chips ("Color: Red", "Min €10.00", "In stock", "On sale") remove one filter each; "Clear all" keeps `q`; "12 products" is announced politely → AC-20
- [ ] Filters leaving nothing → "No products match." and "Clear filters" (keeps `q`); a search with no match → "Try fewer or shorter words" and a link to all products → AC-21
- [ ] As admin: rename, hide, reorder, delete a category, add or remove a product from either side, create a product in a category → the change shows on the very next storefront request → AC-22
- [ ] `/admin/categories/<id>`: drag or keyboard arrange, "Save order" saves; Remove or Add with an unsaved order asks first; another admin adding a product meanwhile → notice and the reloaded list; the storefront category follows the saved order → AC-23
- [ ] Category title is `meta_title` else name, description `meta_description` else description; `/search` titled "Search" with `noindex, follow`; no query text in any title or meta; home and category canonical is the plain path → AC-24
- [ ] axe passes on `/`, a category and `/search` with filters open (Sheet on mobile); every group is a fieldset with a legend; the panel, Sheet, sort and pagination work by keyboard with visible focus → AC-25

## Value sourcing
- [ ] Rename a category and edit its description → category page shows the new `categories.name` / `description`
- [ ] Rearrange a category in admin, compare with home → category Featured follows `product_categories.position`, home follows `products.position`
- [ ] Best match: change a product name so its words start with the query → it moves into the first tier
- [ ] Home title stays the brand name; `/search` title "Search"
- [ ] Active count and chip labels: two values, a Min and In stock → "Filters (4)"; labels use the most common spelling; prices formatted in `STORE_CURRENCY` / `STORE_LOCALE` (try `pl-PL` with PLN)
- [ ] Hide a category → it leaves the nav; reorder categories → nav order follows `categories.position`
- [ ] Card image is the first image by position; sold out only when every live variant has no stock; Sale only on an in stock variant with a compare at price
- [ ] Option group key and order: groups by product count then label; values by first appearance in Featured order and value position
- [ ] Value counts change when another group's selection changes, not when the group's own selection does
- [ ] Price placeholders: archive the cheapest variant → the Min placeholder moves to the next lowest
- [ ] Price filter: `min=9.5` in EUR is 950 cents; in JPY a fraction is dropped
- [ ] Newest follows `products.created_at`; price sorts use the lowest live variant price (the card's "from" price)
- [ ] Name sort follows `Intl.Collator(STORE_LOCALE)` ("Apple" before "banana"; try `pl-PL` with "Łódź" and "Lato")
- [ ] Result count and page count: 25 matches → "25 products", 2 pages
- [ ] Category without `meta_title` uses its name; with one uses it
- [ ] Canonical on `/categories/<slug>?page=2&color=red` is `<site>/categories/<slug>`
- [ ] Arrange save writes positions `0..n-1` in the submitted order

## Commands
- [ ] `pnpm test` → the pure rules pass (`src/lib/search-text.test.ts`, `src/features/catalog/listing/*.test.ts`) → AC-5, AC-7 to AC-9, AC-12 to AC-18
- [ ] `pnpm test:db` → `tests/db/catalog-listing.db.test.ts` and `tests/db/categories.db.test.ts` pass → AC-2, AC-3, AC-22, AC-23
- [ ] `pnpm test:e2e tests/e2e/catalog/discovery.spec.ts` → green on desktop and mobile → AC-1 to AC-25

## Acceptance-criteria coverage
- AC-1 to AC-25 each have a UI step above; AC-22 and AC-23 also a db test; AC-25 the axe and keyboard e2e.
