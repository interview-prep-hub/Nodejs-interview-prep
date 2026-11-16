// Helper: this file is meant to FAIL under plain type stripping (a namespace with values needs generated code).
namespace Util {
  export const double = (n: number): number => n * 2;
}
console.log(Util.double(21));
