import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type ConsentCategory, type CookieRegistry } from "@/lib/consent/consent";

const categoryLabels: Readonly<Record<ConsentCategory, string>> = {
  necessary: "Necessary",
  analytics: "Analytics",
  marketing: "Marketing",
};

// spec 0017, AC-17: the registry as the /cookies table. Cells wrap; on a narrow screen the box
// scrolls sideways and can take keyboard focus, so a keyboard user can scroll it too.
export function CookieTable({ registry }: { readonly registry: CookieRegistry }) {
  return (
    <Table
      containerProps={{
        tabIndex: 0,
        role: "region",
        "aria-labelledby": "cookie-table-caption",
        className: "rounded-md border",
      }}
      className="min-w-xl"
    >
      <TableCaption id="cookie-table-caption" className="mt-0 mb-2 caption-top text-left">
        Every cookie the store sets
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Cookie</TableHead>
          <TableHead scope="col">Category</TableHead>
          <TableHead scope="col">Purpose</TableHead>
          <TableHead scope="col">Lifetime</TableHead>
          <TableHead scope="col">Set by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registry.map((entry) => (
          <TableRow key={entry.name}>
            <TableCell className="align-top font-mono text-xs break-all whitespace-normal">
              {entry.name}
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              {categoryLabels[entry.category]}
            </TableCell>
            <TableCell className="align-top whitespace-normal">{entry.purpose}</TableCell>
            <TableCell className="align-top whitespace-normal">{entry.lifetime}</TableCell>
            <TableCell className="align-top whitespace-normal">{entry.setBy}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
