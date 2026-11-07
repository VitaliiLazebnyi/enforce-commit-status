/**
 * @file Reading the repository's files and JSON documents, local and remote, as unknown values
 * that the scripts narrow before use.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * The repository root.
 */
export const root = path.resolve(import.meta.dirname, '..', '..');

const HTTP_NOT_FOUND = 404;

/**
 * Narrows an unknown value to an object whose properties can be read (as unknown).
 * @param value - Any value.
 * @returns Whether the value is a non-null object.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads an object property of a parsed document, or an empty object.
 * @param value - The parsed document.
 * @param key - The property name.
 * @returns The property when it is an object, otherwise an empty object.
 */
export function recordProperty(value: unknown, key: string): Readonly<Record<string, unknown>> {
  const property = isRecord(value) ? value[key] : undefined;
  return isRecord(property) ? property : {};
}

/**
 * Lists the properties of an object.
 * @param record - The object.
 * @returns The name and value of every property, in order.
 */
export function entriesOf(
  record: Readonly<Record<string, unknown>>
): readonly (readonly [string, unknown])[] {
  return Object.entries(record);
}

/**
 * Finds every match of a pattern (with the `g` flag) in a text.
 * @param text - The text to search.
 * @param pattern - The pattern; its named groups are returned.
 * @returns The named groups of every match, in order.
 */
export function matchesOf(
  text: string,
  pattern: RegExp
): readonly Readonly<Record<string, string | undefined>>[] {
  const matches: Readonly<Record<string, string | undefined>>[] = Array.from(
    text.matchAll(pattern),
    match => ({ ...match.groups })
  );
  return matches;
}

/**
 * Reads a string property, failing loudly on unexpected input.
 * @param record - The object.
 * @param key - The property name.
 * @param context - Where the object came from, for the error message.
 * @returns The string value.
 * @throws {TypeError} When the property is not a string.
 */
export function stringProperty(record: unknown, key: string, context: string): string {
  const value = isRecord(record) ? record[key] : undefined;
  if (typeof value !== 'string') {
    throw new TypeError(`${context}: expected a string "${key}"`);
  }
  return value;
}

/**
 * Parses JSON into an unknown value.
 * @param text - A JSON document.
 * @returns The parsed value.
 */
export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/**
 * Reads a text file of the repository.
 * @param file - The path relative to the repository root.
 * @returns The file's content.
 */
export async function readText(file: string): Promise<string> {
  return readFile(path.join(root, file), 'utf8');
}

/**
 * Reads a JSON file of the repository.
 * @param file - The path relative to the repository root.
 * @returns The parsed value.
 */
export async function readJson(file: string): Promise<unknown> {
  return parseJson(await readText(file));
}

/**
 * Fetches a JSON document.
 * @param url - The URL of the document.
 * @returns The parsed body, or undefined for a 404.
 * @rejects {Error} For any other unsuccessful response.
 */
export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === HTTP_NOT_FOUND) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${String(response.status)}`);
  }
  const value: unknown = await response.json();
  return value;
}
