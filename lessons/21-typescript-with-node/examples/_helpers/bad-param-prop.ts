// Helper: this file is meant to FAIL under plain type stripping (parameter properties need generated code).
class Account {
  constructor(private owner: string) {}
  describe(): string {
    return `account of ${this.owner}`;
  }
}
console.log(new Account('Asha').describe());
