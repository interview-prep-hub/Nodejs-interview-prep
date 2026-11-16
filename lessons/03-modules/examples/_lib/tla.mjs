// An ES module with top-level await. It cannot be loaded with require().
export const value = await Promise.resolve('loaded asynchronously');
