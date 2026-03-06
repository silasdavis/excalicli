declare module "wawoff2" {
  export function decompress(woff2Data: Buffer | Uint8Array): Promise<Uint8Array>;
  export function compress(sfntData: Buffer | Uint8Array): Promise<Uint8Array>;
}
