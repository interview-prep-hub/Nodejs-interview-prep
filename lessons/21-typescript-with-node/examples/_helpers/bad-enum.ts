// Helper: this file is meant to FAIL under plain type stripping (enum needs generated code).
enum Color {
  Red,
  Green,
}
console.log(Color.Green);
