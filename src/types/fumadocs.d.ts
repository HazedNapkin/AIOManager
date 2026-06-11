declare module '@/.source' {
  export const docs: any;
  export const meta: any;
}

declare module 'fumadocs-mdx' {
  export const createMDXSource: (docs: any, meta: any) => any;
}
