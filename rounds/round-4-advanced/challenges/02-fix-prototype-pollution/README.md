# Debug it: the polluted merge

Difficulty: Medium | Time box: 30 minutes | Skills: prototype pollution, safe object merging

## Report from production

"After a user sent a crafted JSON body to our settings endpoint, every user in the process suddenly became an admin until we restarted. The endpoint merges the body into a default settings object."

## Task

Open `deep-merge.js`. `deepMerge(target, source)` recursively copies keys from `source` into `target`. Fix it so that:

- a payload from `JSON.parse` such as `{"__proto__": {"polluted": true}}` never changes `Object.prototype` (so `({}).polluted` stays `undefined`), at any depth;
- `constructor.prototype` payloads are blocked too;
- normal merging still works: nested objects are merged, arrays are replaced;
- inherited (prototype chain) properties of `source` are not copied;
- the function returns `target`.

## Run

```bash
npm run challenge -- fix-prototype-pollution
npm run challenge -- fix-prototype-pollution --solution
```

## Hints

<details>
<summary>Hint 1</summary>

`JSON.parse` creates an OWN property called `__proto__`. Plain code that does `target['__proto__']` reads the real prototype, not a normal property.
</details>

<details>
<summary>Hint 2</summary>

Skip the keys `__proto__`, `constructor` and `prototype` before doing anything else with a key.
</details>

<details>
<summary>Hint 3</summary>

Loop with `Object.keys(source)` (own keys only), and only recurse into `target[key]` when it is an OWN property that is a plain object.
</details>

## Interviewer follow-ups

- Other defences? (`Object.create(null)` for dictionaries, `Map`, `Object.freeze(Object.prototype)` as defence in depth, schema validation, and `node --disable-proto=delete`.)
- Why is pollution dangerous even though it only adds a property? (Code elsewhere reads missing properties such as `user.isAdmin` and now finds `true` through the prototype chain.)
