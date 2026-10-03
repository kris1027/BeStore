// Pure rules for a product's status (spec 0009, State transitions). Hide is active to draft,
// archive is retirement, restore brings an archived product back as a draft, never live.

export type ProductStatus = "draft" | "active" | "archived";

const transitions: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  draft: ["active", "archived"],
  active: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return transitions[from].includes(to);
}

export type StatusAction = "publish" | "hide" | "archive" | "restore";

const actionTarget: Readonly<Record<StatusAction, ProductStatus>> = {
  publish: "active",
  hide: "draft",
  archive: "archived",
  restore: "draft",
};

// The buttons the edit page shows for a status, in the order it shows them (AC-2).
export function statusActions(status: ProductStatus): readonly StatusAction[] {
  switch (status) {
    case "draft":
      return ["publish", "archive"];
    case "active":
      return ["hide", "archive"];
    case "archived":
      return ["restore"];
  }
}

export function statusActionTarget(action: StatusAction): ProductStatus {
  return actionTarget[action];
}

// AC-3: a product going live lands first on the home grid, one below the lowest active
// position, or 0 when nothing is active.
export function publishPosition(lowestActivePosition: number | null): number {
  return lowestActivePosition === null ? 0 : lowestActivePosition - 1;
}
