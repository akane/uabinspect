export class EOFError extends Error {
  constructor() {
    super("end of file");
  }
}

export enum Endian {
  Little,
  Big,
}

export abstract class ByteReader {
  protected buffer: Uint8Array;
  protected position: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.buffer = new Uint8Array(buffer);
  }

  u8() {
    if (this.position === this.buffer.length) throw new EOFError();
    return this.buffer[this.position++];
  }

  bytes(length: number) {
    if (length < 0) throw new Error("negative length not allowed");
    if (this.position + length > this.buffer.length) throw new EOFError();
    const start = this.position;
    this.position += length;
    return this.buffer.slice(start, this.position).buffer;
  }

  c_str(max_length: number) {
    const start = this.position;
    for (let length = 0; length < max_length && this.u8() !== 0; length++);
    return this.buffer.slice(start, this.position);
  }

  seek(offset: number) {
    if (offset < 0) throw new Error("negative seek offset not allowed");
    if (offset > this.buffer.length) throw new EOFError();
    this.position = offset;
  }

  tell() {
    return this.position;
  }

  get length() {
    return this.buffer.length;
  }

  i16() {
    return this.u16() << 16 >> 16;
  }
  abstract u16(): number;
  abstract i32(): number;
  u32() {
    return this.i32() >>> 0;
  }
  abstract i64(): bigint;
  abstract u64(): bigint;
}

const n32 = BigInt(32);

export class LittleEndianByteReader extends ByteReader {
  u16() {
    const lo = this.u8();
    const hi = this.u8();
    return (hi << 8) | lo;
  }
  i32() {
    const lo = this.u16();
    const hi = this.u16();
    return (hi << 16) | lo;
  }
  i64() {
    const lo = BigInt(this.u32());
    const hi = BigInt(this.i32());
    return (hi << n32) | lo;
  }
  u64() {
    const lo = BigInt(this.u32());
    const hi = BigInt(this.u32());
    return (hi << n32) | lo;
  }
}

export class BigEndianByteReader extends ByteReader {
  u16() {
    const hi = this.u8();
    const lo = this.u8();
    return (hi << 8) | lo;
  }
  i32() {
    const hi = this.u16();
    const lo = this.u16();
    return (hi << 16) | lo;
  }
  i64() {
    const hi = BigInt(this.u32());
    const lo = BigInt(this.i32());
    return (hi << n32) | lo;
  }
  u64() {
    const hi = BigInt(this.u32());
    const lo = BigInt(this.u32());
    return (hi << n32) | lo;
  }
}
