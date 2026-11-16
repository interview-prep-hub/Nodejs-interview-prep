// Helper for 10-import-meta.mjs: reports whether it is the entry file. When another file imports it, it is not.
export const isMain = import.meta.main;
