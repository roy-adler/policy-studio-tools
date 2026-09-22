# Design: KPS list columns

Date: 2026-09-22

## Goal

Edit flat `java.util.List` values in the KPS editor as real JSON arrays. A cell typed as `["value1", "value2"]` or `[3, 5]` is stored as a JSON array of those values, never as a string that looks like an array.

## Decisions (locked)

1. **Approach:** `java.util.List` is its own column type. The cell holds a real array of scalars before Save, so the existing JSON writer cannot emit a string by accident.
2. **Type Group:** `fields.type` of `java.util.List` or `List` marks the column as a list. The element type is `fields.value`, mapped with the existing Java scalar rules (`String`, `Boolean`, `Integer`/`Long`/`Short`/`Byte`, `Double`/`Float`/`Number`, with or without `java.lang.`).
3. **Unknown element type:** Missing or unknown `fields.value` still makes the column an editable list. One schema warning is shown. Elements are not checked against a type.
4. **No coercion:** The text is parsed as JSON and stored as parsed. `[3, 5]` stays numbers. `["3", "5"]` stays strings. Nothing is rewritten to match the element type.
5. **Mismatch:** If any element does not match a known element type, keep the parsed array, mark the cell with a warning, and mark the stage dirty. `null` mismatches every known element type. An integer matches `Double`/`Float`/`Number`. A non-integer number mismatches `Integer`/`Long`/`Short`/`Byte`.
6. **Rejected edits:** Invalid JSON, a non-array, or an array that contains an object or nested array keeps the previous cell value, does not mark dirty, and shows the banner warning used for invalid scalars.
7. **Scope:** Only flat lists of string, number, boolean, or `null`. JSON arrays on columns that are not `java.util.List` stay locked. Nested objects stay locked.
8. **Defaults:** A new row, and a list property missing from JSON, starts as `[]`.
9. **Untouched bad data:** A loaded scalar (including a string that looks like an array) is not converted on load or on Save until the user commits text that parses as a flat scalar array.
10. **Formatting:** Save keeps the current pretty printer (4-space indent, no trailing newline after `]`). Exact spacing inside the text field is not preserved; the JSON types are.

## Data model

- Column type gains `list`, plus the mapped element type per column when `fields.value` is a known scalar.
- A valid list cell value is `Array<string | number | boolean | null>`.
- That array lives on the cell, not in the row’s preserved non-scalar bag. The writer prefers that bag over the cell, so a list left there would ignore edits and could be written back unchanged.
- A list column whose JSON value is an array of only scalars is editable.
- A list column whose JSON value contains an object or nested array stays non-editable, with the existing non-scalar warning.
- A list column whose JSON value is a scalar stays editable, with a warning that it is not a list.

## Edit and display

The grid uses the same single-line input. A list cell shows `JSON.stringify` of the array (`[3,5]`, `["3","5"]`). A scalar sitting in a list column shows that scalar’s existing string form.

On commit of a list column:

1. `JSON.parse` the text.
2. Accept only an array whose elements are all string, number, boolean, or `null`.
3. Store that array as the cell value and clear any preserved non-scalar copy of the same key.
4. If the element type is known and any element mismatches, set the cell warning. The value stays, and the stage is dirty.
5. On reject, leave the cell and dirty flag unchanged and set the banner warning.

On load, a type mismatch also adds a session warning, same as scalar coercion failures.

## Testing

Unit tests cover schema mapping, load of a flat list, load of a string that looks like a list, rejected nested values, mismatch warning without coercion, default `[]`, and write-back that emits a JSON array rather than a string.

## Non-goals

- Editing nested objects or nested arrays
- Coercing list elements to the Type Group element type
- A per-item add/remove UI
- Changing pretty-print rules
