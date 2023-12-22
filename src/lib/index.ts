import { LittleEndianByteReader } from "./ByteReader";

export async function parseAssetBundle(input: Blob) {
  const buffer = await new Response(input).arrayBuffer();
  const reader = new LittleEndianByteReader(buffer);
}
