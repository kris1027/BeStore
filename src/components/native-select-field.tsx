import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export type SelectItem = { readonly value: string; readonly label: string };

type NativeSelectFieldProps = Omit<React.ComponentProps<typeof NativeSelect>, "children"> & {
  readonly id: string;
  readonly label: string;
  readonly items: readonly SelectItem[];
};

// A labelled native select stacked over its label, as the GET filter forms lay them out
// (spec 0016). Item values are unique within a select, so they key the options.
export function NativeSelectField({ id, label, items, ...props }: NativeSelectFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} {...props}>
        {items.map((item) => (
          <NativeSelectOption key={item.value} value={item.value}>
            {item.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
