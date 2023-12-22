import { ByteReader, EOFError } from "./ByteReader";

export async function fetch_blob_range(blob: Blob, begin: number, end: number) {
  assert(begin >= 0, "begin must be >= 0");
  assert(begin <= end, "begin must be <= end");
  if (end > blob.size) throw new EOFError();
  const reader = new FileReader();
  blob = blob.slice(begin, end);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function fetch_blob_chunk(blob: Blob, offset: number, chunk_size = 4096) {
  return fetch_blob_range(blob, offset, Math.min(blob.size, offset + chunk_size));
}

class AssertionError extends Error { }

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

export class ParseError extends Error {
  constructor(message: string, public offset: number) {
    super(message);
  }
}

export function parser_assert(condition: unknown, reader: ByteReader, message?: string): asserts condition {
  if (!condition) {
    throw new ParseError(message ?? "Assertion failed", reader.tell());
  }
}

export function range<T>(n: number, cb: (i: number) => T) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(cb(i));
  return arr;
}
