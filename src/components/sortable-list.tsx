"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useId, useRef } from "react";
import { moveId, sortableAnnouncements, sortableInstructions } from "@/lib/sortable";
import { cn } from "@/lib/utils";

export type SortableItem = {
  readonly id: string;
  // What a screen reader calls the item ("Linen tee", "Photo 2: a red tee").
  readonly name: string;
};

// The one drag and drop list (spec 0009: images, arranging products, categories). A pointer
// drags by the handle; the keyboard lifts with Space, moves with the arrows, drops with Space
// and cancels with Escape, and every step is announced with the item's name. dnd-kit ties
// the instructions to each handle through aria-describedby.
export function SortableList<T extends SortableItem>({
  items,
  label,
  onReorder,
  renderItem,
  disabled = false,
  className,
}: {
  readonly items: readonly T[];
  // The list's accessible name.
  readonly label: string;
  readonly onReorder: (ids: readonly string[]) => void;
  readonly renderItem: (item: T, handle: React.ReactNode, index: number) => React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const contextId = useId();
  const ids = items.map((item) => item.id);
  // Where the lifted item is now. The drop announcement reads it here: by then the parent may
  // already have reordered the items, so a position looked up afresh would be the new one.
  const lastOver = useRef<{ id: string | number; position: number } | null>(null);
  const nameOf = (id: string | number) =>
    items.find((item) => item.id === String(id))?.name ?? "Item";
  const positionOf = (id: string | number) => ids.indexOf(String(id)) + 1;

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const next = moveId(ids, String(active.id), String(over.id));
    if (next !== ids) onReorder(next);
  }

  return (
    <DndContext
      // A stable id: dnd-kit otherwise numbers its hidden instructions per render, and the
      // server and browser numbers differ (a hydration mismatch on aria-describedby).
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: sortableInstructions },
        announcements: {
          onDragStart: ({ active }) => {
            lastOver.current = { id: active.id, position: positionOf(active.id) };
            return sortableAnnouncements.start(
              nameOf(active.id),
              positionOf(active.id),
              ids.length,
            );
          },
          // A lifted item is first "over" its own slot; saying so would talk over "Picked up".
          onDragOver: ({ active, over }) => {
            if (!over || over.id === lastOver.current?.id) return undefined;
            lastOver.current = { id: over.id, position: positionOf(over.id) };
            return sortableAnnouncements.over(nameOf(active.id), positionOf(over.id), ids.length);
          },
          onDragEnd: ({ active }) =>
            sortableAnnouncements.end(
              nameOf(active.id),
              lastOver.current?.position ?? positionOf(active.id),
              ids.length,
            ),
          onDragCancel: ({ active }) =>
            sortableAnnouncements.cancel(nameOf(active.id), positionOf(active.id), ids.length),
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ol aria-label={label} className={cn("flex flex-col gap-2", className)}>
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              item={item}
              index={index}
              disabled={disabled}
              renderItem={renderItem}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow<T extends SortableItem>({
  item,
  index,
  disabled,
  renderItem,
}: {
  readonly item: T;
  readonly index: number;
  readonly disabled: boolean;
  readonly renderItem: (item: T, handle: React.ReactNode, index: number) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled });

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Move ${item.name}`}
      disabled={disabled}
      className="inline-flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GripVerticalIcon aria-hidden="true" className="size-4" />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-80")}
    >
      {renderItem(item, handle, index)}
    </li>
  );
}
