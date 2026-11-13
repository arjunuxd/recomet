/**
 * JSON-compatible value accepted inside free-form attributes.
 *
 * Functions, symbols, BigInt, undefined, class instances, dates, binary data,
 * cyclic graphs, and shared references are not part of this contract.
 */
export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | readonly AttributeValue[]
  | { readonly [key: string]: AttributeValue };

/**
 * An application-owned content item.
 *
 * `id` is opaque, case-sensitive, and never normalized by Recomet.
 */
export interface ContentItem {
  readonly id: string;
  readonly attributes?: Readonly<Record<string, AttributeValue>>;
}
