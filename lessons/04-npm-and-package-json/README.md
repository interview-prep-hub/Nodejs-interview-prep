# 04. npm, package.json and Dependencies

> Level: Beginner   Time: about 180 minutes   Node: 24 (npm 11; notes where older versions differ)

[Previous: 03. Modules: CommonJS and ES Modules](../03-modules/README.md) | [All lessons](../../README.md) | [Next: 05. Core Modules Tour: path, os, util, url, readline and More](../05-core-modules-tour/README.md)

## What you will learn
- What npm really is (a registry, a command and a package manager) and how Yarn and pnpm differ
- How to read any `package.json` in 30 seconds, field by field, and how `main` and `exports` decide which file Node loads
- Semantic versioning and version ranges (`^`, `~`, exact, `*`), with a range checker you build yourself
- How `npm install` turns ranges into a `node_modules` folder, and why `package-lock.json` and `npm ci` exist
- Hoisting, duplicate versions and the phantom dependency problem
- The kinds of dependency (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`), `engines` and `overrides`
- npm scripts, `npx`, global installs, `npm link`, workspaces, publishing, `.npmrc` and Corepack
- Supply-chain security: what can go wrong when you run `npm install`, and the habits that protect you

### How to use this lesson
Read it in order the first time. The sections are short, and most of them end with an interview tip.
- **Core (asked in almost every interview):** sections 1 to 8, 10 and 11.
- **Deeper (mid-level and senior interviews):** sections 9 and 12 to 18.
- **The night before an interview:** read the Key takeaways, section 19 (question bank) and the Quick check.

After each section, run the example it names, change a value, and run it again.

### How the examples work
Run every example from the repo root, for example `node lessons/04-npm-and-package-json/examples/03-semver-ranges.js`.

| Example | What it shows | Uses real npm? |
|---|---|---|
| [01-read-package-json.js](examples/01-read-package-json.js) | Reading a package.json quickly | no |
| [02-semver-versions.js](examples/02-semver-versions.js) | Parse, compare, sort and bump versions | no |
| [03-semver-ranges.js](examples/03-semver-ranges.js) | A mini semver range checker | no |
| [04-resolve-and-hoist.js](examples/04-resolve-and-hoist.js) | How npm picks versions and places folders | no |
| [05-how-node-finds-packages.js](examples/05-how-node-finds-packages.js) | The node_modules walk, `main`, `exports`, `type` | no |
| [06-npm-scripts.js](examples/06-npm-scripts.js) | Hooks, `--`, local binaries, platform traps | yes, offline |
| [07-pack-tarball.js](examples/07-pack-tarball.js) | What ends up in the tarball | yes, offline |
| [08-install-lockfile-ci.js](examples/08-install-lockfile-ci.js) | install, lockfile, ls, explain, ci | yes, local registry |
| [09-dependency-kinds.js](examples/09-dependency-kinds.js) | dev, peer, optional, engines, overrides | yes, local registry |
| [10-install-scripts-and-audit.js](examples/10-install-scripts-and-audit.js) | postinstall, `--ignore-scripts`, audit, outdated | yes, local registry |
| [11-supply-chain-checks.js](examples/11-supply-chain-checks.js) | Integrity hashes, look-alike names, lockfile review | no |
| [12-config-global-link-workspaces.js](examples/12-config-global-link-workspaces.js) | `.npmrc` layers, global install, workspaces, `npm link` | yes, local registry |

Examples 06 to 10 and 12 run the real npm that ships next to your `node` binary and never touch the internet. (If you upgraded npm yourself, `npm -v` on your PATH can print a newer number than the npm these examples use.) Examples 06 and 07 run npm with `--offline`. Examples 08, 09, 10 and 12 each start a tiny pretend registry on `127.0.0.1` (a small http server, see `examples/_local-registry.js`) and point npm at it. Everything happens in a temp folder with its own npm cache and global folder, so your real `~/.npmrc` and global packages are never touched.

Real npm takes a few seconds to start, so these examples need roughly 5 to 15 seconds, depending on how busy your machine is. All npm calls of one example share a time budget of 18 seconds. If npm is too slow, the example prints `Stopped early`, says that its output is incomplete and exits with code 1. It never pretends to have succeeded. (`NPM_EXAMPLE_TRACE=1` prints how long each npm call took, to show you what is slow.) Give it more time like this:

```bash
NPM_EXAMPLE_BUDGET_MS=60000 node lessons/04-npm-and-package-json/examples/10-install-scripts-and-audit.js
```

```powershell
$env:NPM_EXAMPLE_BUDGET_MS=60000; node lessons/04-npm-and-package-json/examples/10-install-scripts-and-audit.js
```

The outputs in this lesson were produced on Windows 11 with Node 24.16.0 and the npm that ships with it (npm 11.13.0). Where a line depends on the operating system, the text says so.

## 1. What npm is
"npm" means three different things. People mix them up in interviews, so keep them apart:

1. **The registry.** A public online database of packages (`registry.npmjs.org`, with the website npmjs.com in front of it). It stores every published version of every package.
2. **The command line tool (CLI).** The `npm` command you type in a terminal. It talks to the registry and manages the `node_modules` folder in your project.
3. **A package manager.** A program that installs your dependencies and the dependencies of those dependencies, and records what it installed.

A **package** is a folder with a `package.json` file. A **module** is a single file Node can load with `require` or `import`. A package usually contains modules. Think of the registry as an app store, `npm` as the installer, and `package.json` as your shopping list.

npm comes with Node. Install Node and you have npm. Node 24.16.0 bundles npm 11.13.0. You may see a newer number if you upgraded npm yourself with `npm install -g npm`. Node 22 bundles npm 10 and Node 24 bundles npm 11.

The ideas in this lesson are the same on both. The wording of some npm messages differs, and a few settings (such as `min-release-age` and the `npm trust` command) exist only in newer npm 11 releases. The text says when that matters.

```bash
node -v
npm -v
```

### Words used in this lesson
You will meet these words again and again. Each one is explained again where it matters.

| Word | Meaning |
|---|---|
| **dependency** | a package your project needs in order to work |
| **transitive dependency** | a dependency of one of your dependencies (you did not ask for it directly) |
| **dependency tree** | all packages, including the transitive ones, and which package needs which |
| **tarball** | the compressed archive (a `.tgz` file) that holds one version of one package |
| **lockfile** | `package-lock.json`: the exact versions npm installed, saved so the next install is identical |
| **hoisting** | moving a package folder up in `node_modules` so that many packages can share one copy |
| **symlink** | a folder alias that points to another folder |
| **install script** | a command that a package asks npm to run when the package is installed |

### npm, Yarn and pnpm
Yarn and pnpm are other package managers. They use the same registry and the same `package.json`. They differ in how they store files and in the lockfile they write.

| | npm | Yarn Classic (1.x) | Yarn 2 and newer | pnpm |
|---|---|---|---|---|
| Comes with Node | yes | no | no | no |
| Lockfile | `package-lock.json` | `yarn.lock` | `yarn.lock` | `pnpm-lock.yaml` |
| Layout on disk | one `node_modules` tree, hoisted, copies only for conflicts | the same idea as npm | by default no `node_modules` at all (Plug'n'Play: a map file tells Node where packages live), optional `node_modules` mode | `node_modules` holds symlinks; real files live once in a shared store |
| Disk use | each project keeps its own copy | each project keeps its own copy | zip archives in a cache folder (the project's own or a shared one, depending on settings) | very low: files are shared between projects (hard links) |
| Phantom dependencies (section 8) | possible | possible | blocked by Plug'n'Play | blocked: only your declared packages are visible |
| The same job as `npm ci` (section 7) | `npm ci` | `yarn install --frozen-lockfile` | `yarn install --immutable` | `pnpm install --frozen-lockfile` |

**Speed.** You will hear "pnpm is faster". It can be, because pnpm links files from one shared store instead of copying them into every project. All of them download packages in parallel and keep a download cache. How much faster one is depends on the cache state, the network and the size of the project, so measure on your own project before you believe a number. Yarn 1.x is in maintenance mode. Bun also ships its own installer.

> **Interview tip:** A strong answer is not "pnpm is better". It is: "They all read the same package.json and use the same registry. The real differences are the node_modules layout (strictness and disk use) and the lockfile format. In a team, pick one and make everyone use it."

## 2. package.json: the ID card of a project
`npm init -y` creates one with defaults. This is the file it wrote on npm 11.13 (the name comes from the folder, and npm prints a `Wrote to <path>:` line before it). The exact list of fields depends on the npm version.

```text
{
  "name": "p5",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs"
}
```

The file must be strict JSON: double quotes, no comments, no trailing commas. Here are the fields you need to know.

| Field | What it does |
|---|---|
| `name` | Package name. Lowercase, URL-safe, at most 214 characters. Scoped names look like `@acme/orders-api`. |
| `version` | A semver version (section 3). With `name` it identifies one published package. |
| `private` | `true` makes npm refuse to publish it. Use it for apps, so you cannot publish by accident. |
| `main` | The file `require('your-package')` loads. Defaults to `index.js`. |
| `module` | A hint for bundlers (tools that merge many files into a few for the browser, such as webpack, Rollup and esbuild): the path of an ES module build. Node itself does not read it. |
| `type` | `"commonjs"` (default) or `"module"`. Decides how `.js` files are read. |
| `exports` | The modern entry map: which files outsiders may load, and which one for `import` and for `require`. Beats `main` (section 9). |
| `imports` | Private aliases that start with `#`, usable only by the package's own files (lesson 03, section 15). |
| `bin` | Command names to create, for example `{ "orders-cli": "./bin/cli.js" }`. |
| `scripts` | Named shell commands, run with `npm run <name>` (section 11). |
| `files` | The whitelist of files that go into the published tarball, the archive that is uploaded (section 15). |
| `engines` | Node and npm versions the package supports. Only a warning by default. |
| `dependencies` | Packages needed at run time. |
| `devDependencies` | Packages needed only to build, test or lint. |
| `peerDependencies` | Packages the *host* project must provide (plugins). |
| `optionalDependencies` | Packages that may fail to install without failing the whole install. |
| `overrides` | Forces a version somewhere deep in the tree (root `package.json` only). |
| `workspaces` | Folder patterns of local packages in a monorepo (section 14). |
| `packageManager` | Which package manager and version the project expects, for Corepack (section 16). |
| `license`, `repository`, `homepage`, `bugs`, `keywords`, `description` | Metadata for the registry page. |
| `publishConfig` | Settings used only when you publish (registry, tag, access). |
| `types`, `sideEffects`, `os`, `cpu` | Less common. `types`: where the TypeScript typings are. `sideEffects`: a hint for bundlers that unused files can be dropped. `os` and `cpu`: the systems the package runs on. |

You can read and change a field without opening the file. `npm pkg get name version` prints the values as JSON, and `npm pkg set scripts.lint="eslint ."` writes a new script.

### Read a package.json in 30 seconds
The fixture [examples/_fixtures/sample-package.json](examples/_fixtures/sample-package.json) is a typical service. Example [01-read-package-json.js](examples/01-read-package-json.js) reads it the way you should: identity, loading style, how to run it, what it needs.

```js
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`Package : ${pkg.name}@${pkg.version}${pkg.private ? '  (private: npm refuses to publish it)' : ''}`);
console.log(`Module  : .js files are ${pkg.type === 'module' ? 'ES modules' : 'CommonJS'}`);
// ...then scripts, the four dependency kinds, range styles, engines, workspaces, overrides, files
```

```text
Package : @acme/orders-api@2.3.1  (private: npm refuses to publish it)
Module  : .js files are ES modules
Entry   : exports map (main is only a fallback for old tools)
Commands: orders-cli (installed into node_modules/.bin)

Scripts:
  npm run start    -> node dist/server.js
  npm run dev      -> node --watch src/server.js
  npm run build    -> tsc -p tsconfig.build.json
  npm run test     -> node --test
  npm run lint     -> eslint .
  npm run prepare  -> npm run build

Dependencies:
  dependencies         (3) express@^5.1.0, pg@~8.16.0, zod@4.0.5
  devDependencies      (3) @types/node@^24.0.0, eslint@^9.0.0, typescript@^5.8.0
  peerDependencies     (1) pino@>=9
  optionalDependencies (1) fsevents@^2.3.0

Range style of "dependencies":
  express  ^5.1.0   caret (minor + patch updates allowed)
  pg       ~8.16.0  tilde (patch updates only)
  zod      4.0.5    exact (pinned, never moves)

Needs Node >=22.12.0. You are running v24.16.0.
Workspaces: packages/*
Overrides : {"qs":"6.14.0"} (forces versions inside the tree)
Published files: dist, bin (+ package.json, README, LICENSE)
```

The "You are running" line shows your own Node version. The routine, in order:

1. `name`, `version`, `private`: what is it, and can it be published?
2. `type`, `exports` or `main`, `bin`: how is it loaded and what commands does it add?
3. `scripts`: how do I run, build and test it?
4. The dependency fields: what does it need, and how strictly is each version pinned?
5. `engines` and `packageManager`: which Node and which package manager?

> **Remember:** `package.json` is for people and for npm. `package-lock.json` (section 6) is for exact repeatability. Do not mix up their jobs.

> **Interview tip:** "You join a team. How do you get to know an unfamiliar Node project?" A strong answer: "I open `package.json` and go through the routine above: identity, how it is loaded, the scripts, the dependencies and how strictly they are pinned, then `engines`. After that I run `npm ci` and `npm test`."

## 3. Semantic versioning (semver)
Almost every package uses **semantic versioning**: a version has three numbers, `MAJOR.MINOR.PATCH`, for example `2.14.3`.

| Part | Changes when | Safe to upgrade? |
|---|---|---|
| `PATCH` (2.14.**3**) | a bug is fixed, nothing else changes | yes |
| `MINOR` (2.**14**.3) | a feature is added, old code still works | yes |
| `MAJOR` (**2**.14.3) | something changed in a way that can break your code | only after you read the changelog |

A **breaking change** is any change that can make code that worked before stop working: removing or renaming a function, changing what it returns or what arguments mean, or dropping support for a Node version people use. Version `0.x.y` means "initial development": anything may change, and npm treats it more carefully (section 4).

A version can carry a **prerelease tag**: `1.0.0-beta.2`. It sorts *before* `1.0.0`. Text after `+` (`1.0.0+build.7`) is build metadata and is ignored when comparing.

Example [02-semver-versions.js](examples/02-semver-versions.js) parses, compares and bumps versions without any library:

```js
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (const part of ['major', 'minor', 'patch']) {
    if (x[part] !== y[part]) return x[part] < y[part] ? -1 : 1; // compare as NUMBERS
  }
  return comparePrerelease(x.prerelease, y.prerelease);
}
```

```text
parse("2.14.3-beta.2+build.7") = { major: 2, minor: 14, patch: 3, prerelease: [ 'beta', '2' ] }

sorted as text   : 1.0.0  1.10.0  1.2.0  1.9.0  2.0.0
sorted as semver : 1.0.0  1.2.0  1.9.0  1.10.0  2.0.0

prerelease order : 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0

bump("1.4.2", "patch") = 1.4.3   (bug fix, nothing breaks)
bump("1.4.2", "minor") = 1.5.0   (new feature, still compatible)
bump("1.4.2", "major") = 2.0.0   (breaking change)

parse("1.2") fails: Not a valid version: "1.2"
```

Why: versions are compared number by number, so `1.10.0` is higher than `1.9.0`. Sorting them as text gets that wrong. Inside a prerelease tag, numbers compare as numbers (`beta.2 < beta.11`), words compare alphabetically, and fewer fields rank lower (`alpha < alpha.1`).

`npm version patch`, `npm version minor` and `npm version major` do the bump for you. They rewrite `package.json` and print the new version. Inside a git repository they also create a commit and a tag.

```text
$ npm version minor
v1.1.0
```

For a beta, use `prerelease` with `--preid` (the label). Run by hand in a folder that was at `1.0.0` and is not a git repository:

```text
$ npm version prerelease --preid=beta
v1.0.1-beta.0
$ npm version prerelease --preid=beta
v1.0.1-beta.1
$ npm version patch
v1.0.1
```

Note the last step: bumping a prerelease with `patch` finishes it (`1.0.1-beta.1` becomes `1.0.1`). You publish a beta under its own tag, so that a normal `npm install` never picks it (section 15).

> **Interview tip:** "What does semantic versioning promise, and what is a breaking change?" A strong answer: "Patch is a bug fix, minor is a backward-compatible feature, major may break existing code (a removed or renamed function, a changed return value, a dropped Node version). Versions below 1.0.0 are for initial development, and anything may change."

> **Common mistake:** Believing that semver is a guarantee. It is a promise made by humans. A "patch" release can still break you. That is why lockfiles exist (section 6).

## 4. Version ranges: ^ ~ exact and friends
In `package.json` you rarely write one exact version. You write a **range**: the set of versions you accept. npm picks a version inside the range when you install.

| Range | Means | Matches `1.2.3`, `1.2.9`, `1.9.9`, `2.0.0`? |
|---|---|---|
| `1.2.3` | exactly this version | only `1.2.3` |
| `^1.2.3` (caret) | `>=1.2.3 <2.0.0`: no change to the left-most non-zero number | `1.2.3`, `1.2.9`, `1.9.9` |
| `~1.2.3` (tilde) | `>=1.2.3 <1.3.0`: patch updates only | `1.2.3`, `1.2.9` |
| `1.x` or `1.*` | `>=1.0.0 <2.0.0` | all except `2.0.0` |
| `*` or empty | any version | all four |
| `>=1.2.3 <1.9.0` | a space means AND | `1.2.3`, `1.2.9` |
| `1.2.3 - 1.3.0` | a hyphen range: `>=1.2.3 <=1.3.0` | `1.2.3`, `1.2.9` |

Two ranges joined by `||` mean OR: `<1.2.3 || >=2.1.0`.

The caret treats `0.x` versions with extra care, because "initial development" means a minor bump may break things:

| Range | Means |
|---|---|
| `^1.2.3` | `>=1.2.3 <2.0.0` |
| `^0.2.3` | `>=0.2.3 <0.3.0` |
| `^0.0.3` | `>=0.0.3 <0.0.4` (only that exact patch) |

Some dependency values are not versions at all: a dist-tag (`"next"`, `"latest"`), a git URL (`github:user/repo`), a folder (`file:../lib`) or an alias (`npm:other-package@^1.0.0`). Git and `latest` are risky, because they move or are not reviewed.

Example [03-semver-ranges.js](examples/03-semver-ranges.js) is a hand-written range checker (about 100 lines). Its core turns each range into plain comparators and tests them:

```js
function caret(text) {
  const p = partial(text);
  const low = ge(full(p));
  if (p.major === undefined) return [ge('0.0.0')];
  if (p.major > 0) return [low, lt(`${p.major + 1}.0.0`)]; // ^1.2.3 -> <2.0.0
  if (p.minor === undefined) return [low, lt('1.0.0')]; // ^0 -> <1.0.0
  if (p.minor > 0 || p.patch === undefined) return [low, lt(`0.${p.minor + 1}.0`)]; // ^0.2.3 -> <0.3.0
  return [low, lt(`0.0.${p.patch + 1}`)]; // ^0.0.3 -> <0.0.4 (only that patch)
}
```

```text
Published versions: 0.2.9 0.3.0 1.2.2 1.2.3 1.2.9 1.3.0 1.9.9 2.0.0-beta.1 2.0.0 2.1.0 

1.2.3              means 1.2.3
                   matches: 1.2.3  -> highest match: 1.2.3

^1.2.3             means >=1.2.3 <2.0.0
                   matches: 1.2.3 1.2.9 1.3.0 1.9.9  -> highest match: 1.9.9

~1.2.3             means >=1.2.3 <1.3.0
                   matches: 1.2.3 1.2.9  -> highest match: 1.2.9

1.x                means >=1.0.0 <2.0.0
                   matches: 1.2.2 1.2.3 1.2.9 1.3.0 1.9.9  -> highest match: 1.9.9

*                  means >=0.0.0
                   matches: 0.2.9 0.3.0 1.2.2 1.2.3 1.2.9 1.3.0 1.9.9 2.0.0 2.1.0  -> highest match: 2.1.0

>=1.2.3 <1.9.0     means >=1.2.3 <1.9.0
                   matches: 1.2.3 1.2.9 1.3.0  -> highest match: 1.3.0

1.2.3 - 1.3.0      means >=1.2.3 <=1.3.0
                   matches: 1.2.3 1.2.9 1.3.0  -> highest match: 1.3.0

^0.2.9             means >=0.2.9 <0.3.0
                   matches: 0.2.9  -> highest match: 0.2.9

~2.0.0             means >=2.0.0 <2.1.0
                   matches: 2.0.0  -> highest match: 2.0.0

<1.2.3 || >=2.1.0  means <1.2.3  ||  >=2.1.0
                   matches: 0.2.9 0.3.0 1.2.2 2.1.0  -> highest match: 2.1.0

Prerelease rule (a beta is only chosen when you ask for that beta):
  satisfies("2.0.0-beta.1", "^1.2.3") = false
  satisfies("2.0.0-beta.1", ">=1.0.0") = false
  satisfies("2.0.0-beta.1", "^2.0.0-beta.0") = true
  satisfies("2.0.0-beta.1", "2.x") = false
```

Note the last block: **a prerelease version only matches a range that itself mentions a prerelease of the same `major.minor.patch`**. So `^1.2.3` never installs `2.0.0-beta.1` by surprise. (This mini checker was cross-checked against the real `semver` package that npm bundles, on hundreds of range and version pairs, with no differences for the syntax it supports. The real package also accepts looser forms such as `>1` (which means `>=2.0.0`) and `<=1` (which means `<2.0.0`). For those the mini checker throws an error instead of guessing.)

> **Under the hood:** "Highest match" is almost the full story. One twist: if the version tagged `latest` on the registry also satisfies your range, npm picks *that one*, even when a higher matching version exists under another tag such as `next`. In a test with a registry where `latest` was `1.1.0`, `next` was `1.2.0` and the range was `^1.0.0`, npm installed `1.1.0`.

When you run `npm install some-package`, npm writes a caret range by default (the `save-prefix` setting is `^`):

| Command (against the pretend registry, where 2.1.0 is the latest) | What npm wrote into `package.json` |
|---|---|
| `npm install demo-utils` | `"demo-utils": "^2.1.0"` |
| `npm install demo-utils --save-exact` | `"demo-utils": "2.1.0"` |
| `npm install demo-utils@~1.0.0` | `"demo-utils": "~1.0.0"` (your own range is kept) |

Rule of thumb: use `^` (the default) for most dependencies, `~` or an exact version for things that break often, and always rely on the lockfile for repeatable installs. Avoid `*`, `latest` and `>=1.0.0`: they accept future major versions, which are allowed to break your code.

> **Interview tip:** "What is the difference between `^1.2.3` and `~1.2.3`?" A strong answer: "Caret allows minor and patch updates (below `2.0.0`), tilde allows only patch updates (below `1.3.0`). For `0.x` versions the caret is stricter: `^0.2.3` stays below `0.3.0`. A range only says what is *allowed*. The lockfile says what you actually *get*."

## 5. Installing: from package.json to node_modules
What happens when you type `npm install`:

1. npm reads `package.json` (and `package-lock.json` if it exists).
2. For each dependency it asks the registry for the package's list of versions and picks one that fits the range.
3. It reads that version's own `dependencies` and repeats the work. This builds the **dependency tree**.
4. It downloads each package as a **tarball** (a gzip-compressed archive, a `.tgz` file) and checks its hash.
5. It unpacks the tarballs into `node_modules`, creates command links in `node_modules/.bin`, and runs install scripts.
6. It writes `package-lock.json`.

The tree is the interesting part. When two packages need different versions of the same package, npm keeps both copies. Whenever it can, it puts a copy as high up in `node_modules` as possible, so that several packages share it. That is **hoisting**: moving a folder up so that many packages can use one copy and Node can still find it.

The shared pretend registry for the examples ([_demo-packages.js](examples/_demo-packages.js)) has a conflict on purpose. `demo-ui` 1.x needs `demo-utils` 1.x, but `demo-log` 2.x needs `demo-utils` 2.x. Example [04-resolve-and-hoist.js](examples/04-resolve-and-hoist.js) simulates the algorithm. It keeps a queue of requests ("the package in folder `from` needs `name` in this `range`"). This is the core of the loop that handles one request, shortened:

```js
const { from, name, range } = queue.shift();

// 1. Does a copy already visible from here fit? (Node looks in the nearest node_modules first.)
let visible = null;
for (let dir = from; dir && !visible; dir = dir.parent) visible = dir.children.get(name) || null;
if (visible && satisfies(visible.version, range)) continue; // reuse it

// 2. Pick the highest published version that matches the range.
const version = maxSatisfying(Object.keys(registry[name]), range);

// 3. Hoist: use the folder closest to the root that does not already hold a different copy.
const route = [];
for (let dir = from; dir; dir = dir.parent) route.unshift(dir);
const target = route.find((dir) => !dir.children.has(name));
target.children.set(name, folder(name, version, target));
```

```text
package.json of demo-app:
  dependencies    {"demo-ui":"^1.2.0","demo-log":"~2.0.0"}
  devDependencies {"demo-lint":"^3.0.0"}

--- Install with a conflict (ui 1.x needs utils 1.x, log 2.x needs utils 2.x) ---
  demo-app wants demo-lint@^3.0.0: choose 3.2.0, put it at the top level
  demo-app wants demo-log@~2.0.0: choose 2.0.1, put it at the top level
  demo-app wants demo-ui@^1.2.0: choose 1.3.0, put it at the top level
  demo-log wants demo-utils@^2.0.0: choose 2.1.0, put it at the top level
  demo-ui wants demo-utils@^1.0.0: choose 1.4.0, put it inside demo-ui/node_modules

Resulting node_modules:
demo-app
+-- demo-lint@3.2.0
+-- demo-log@2.0.1
+-- demo-ui@1.3.0
|   `-- demo-utils@1.4.0
`-- demo-utils@2.1.0

As lockfile paths: {
  'node_modules/demo-lint': '3.2.0',
  'node_modules/demo-log': '2.0.1',
  'node_modules/demo-ui': '1.3.0',
  'node_modules/demo-ui/node_modules/demo-utils': '1.4.0',
  'node_modules/demo-utils': '2.1.0'
}

Top-level folders your package.json never asked for: demo-utils
Your code can still require() them. That is a phantom dependency.

--- Same project, but demo-ui moves to ^2.0.0 (no more conflict) ---
demo-app
+-- demo-lint@3.2.0
+-- demo-log@2.0.1
+-- demo-ui@2.0.0
`-- demo-utils@2.1.0

--- Production install (npm install --omit=dev) skips devDependencies ---
node_modules/demo-log
node_modules/demo-ui
node_modules/demo-ui/node_modules/demo-utils
node_modules/demo-utils
```

The simulation works breadth first and in alphabetical order. `demo-log` comes before `demo-ui`, so its `demo-utils@2.1.0` wins the top spot, and `demo-ui` gets its own nested copy. Example 08 below runs the real npm on the same packages and checks that the real layout equals this simulation (it does, for this input).

> **Interview tip:** "What happens when you run `npm install`?" A strong answer follows the steps above: read `package.json` and the lockfile, pick versions that fit the ranges, build the tree, download the tarballs (or take them from the cache) and verify their hashes, unpack them with hoisting, link the binaries into `.bin`, run install scripts, write the lockfile.

### Where downloads are kept: the npm cache
npm does not download the same tarball twice. Every download is stored in a **cache** folder (`npm config get cache` shows where), under the hash of its content. The next install of that version reads the file from the cache, and the hash is checked again on the way out.

- `npm install --offline` uses only the cache and never touches the network. `--prefer-offline` uses cached data without asking the server whether it is still fresh.
- `npm cache verify` checks the cache and removes data nobody needs.
- You almost never need `npm cache clean --force`. The cache repairs itself, so clear it only to free disk space. CI systems often save the cache folder between runs to install faster.

### The install commands you need

| Command | What it does |
|---|---|
| `npm install` | Install everything in `package.json` (using the lockfile if it matches) |
| `npm install pkg` | Add `pkg` to `dependencies` with a `^` range, and install it |
| `npm install -D pkg` | Add it to `devDependencies` |
| `npm install -E pkg` | Save the exact version instead of a range |
| `npm uninstall pkg` | Remove it from `package.json` and `node_modules` |
| `npm update` | Move installed versions up to the newest version each *range* allows |
| `npm install pkg@latest` | Jump to the newest release, even across a major version |
| `npm prune` | Delete folders in `node_modules` that `package.json` does not list |
| `npm dedupe` | Merge duplicate copies where the ranges allow it |

> **Common mistake:** Hand-editing `node_modules` or committing it to git. It is output, not source. Delete it any time and run `npm install` again.

## 6. package-lock.json: why it exists
Ranges make installs *not repeatable*. `^2.0.0` means "2.1.0" today and "2.1.1" next week. Two teammates, or your laptop and the production build, can end up with different code.

`package-lock.json` is the fix. After an install npm writes down the *exact* tree it built: every version, where it was downloaded from and a hash of the tarball. The next `npm install` (or `npm ci`) rebuilds the same tree.

Example [08-install-lockfile-ci.js](examples/08-install-lockfile-ci.js) runs real npm against the pretend registry and reads the lockfile it writes:

```text
$ npm install
added 5 packages

package-lock.json (lockfileVersion 3) has these package entries:
  node_modules/demo-lint                         3.2.0  dev   sha512-...
  node_modules/demo-log                          2.0.1  prod  sha512-...
  node_modules/demo-ui                           1.3.0  prod  sha512-...
  node_modules/demo-ui/node_modules/demo-utils   1.4.0  prod  sha512-...
  node_modules/demo-utils                        2.1.0  prod  sha512-...

One entry in full: {
  "version": "2.1.0",
  "resolved": "<registry>/-/demo-utils-2.1.0.tgz",
  "integrity": "sha512-<hash of the tarball>"
}

Same layout as the simulation in example 04? true
```

(`<registry>` stands for `http://127.0.0.1:<random port>`. The example hides the hash itself, because it depends on the exact bytes.)

How to read an entry:
- The key is the **path** inside the project. `node_modules/demo-ui/node_modules/demo-utils` is the nested copy.
- `version` is the exact version. `resolved` is the download URL. `integrity` is a `sha512` hash of the tarball. npm recomputes it after downloading, and refuses the package if it differs (error `EINTEGRITY`).
- Flags such as `dev`, `optional`, `peer` and `hasInstallScript` say how the package is used.
- `lockfileVersion: 3` is the format current npm writes for a new lockfile. npm 7 and 8 wrote version 2, and npm 5 and 6 wrote version 1.
- The `""` entry at the top is the root project itself.

Other facts to know:
- **The lock wins over the registry.** When you run `npm install` and the lockfile already satisfies every range in `package.json`, npm installs the locked versions and does not look for newer ones. Versions move only when you change a dependency or run `npm update`.
- **Commit it** for applications and services, so every machine and every deployment installs the same tree. Read lockfile changes in code review: a new `resolved` host or an unexpected package is a warning sign.
- **Do not hand-edit it.** After a merge conflict, fix `package.json`, then run `npm install` to regenerate the lock.
- A library's `package-lock.json` is *not* published (it is ignored outside the root project). The file that npm does publish is `npm-shrinkwrap.json`. It is rarely recommended; npm's own docs suggest it only for tools you deploy as a whole.
- `node_modules/.package-lock.json` is a hidden copy npm uses as a cache so it does not have to scan the whole folder. You can ignore it.

> **Interview tip:** "Why do we commit the lockfile?" A strong answer: "`package.json` holds ranges, the lockfile holds the exact resolved tree and the hashes. With the lockfile every developer, CI job and server gets the same bytes, builds are reproducible, and a bad new release of a dependency cannot sneak in until someone deliberately updates."

## 7. npm install vs npm ci
Both build `node_modules`. They are meant for different situations.

| | `npm install` | `npm ci` ("clean install") |
|---|---|---|
| Needs a lockfile | no (it creates one) | yes, it fails without one |
| If `package.json` and the lock disagree | updates the lock | stops with an error |
| Writes `package.json` or the lock | may do both | never |
| Existing `node_modules` | reuses and adjusts it | deletes it first |
| Typical use | on your laptop, when changing dependencies | CI, Docker builds, deployments |

Two more details. `npm ci` always installs the whole project, so you cannot add one package with it (`npm ci express` is not allowed). And if you built the lockfile with flags that change the tree shape, such as `--legacy-peer-deps`, `npm ci` needs the same flags, otherwise it may report a mismatch. Put such flags in the project `.npmrc` (section 16) so every machine uses them.

The same example runs `npm ci` twice, on copies that hold only `package.json`, the lockfile and a junk folder named `stale-leftover`. The first copy is in sync. In the second copy `package.json` was changed to `demo-log ^2.1.0` while the lock still says `2.0.1`.

```text
$ npm ls --all
demo-app@1.0.0 <project>
+-- demo-lint@3.2.0
+-- demo-log@2.0.1
| `-- demo-utils@2.1.0
`-- demo-ui@1.3.0
  `-- demo-utils@1.4.0

$ npm ci   (project and lockfile agree)
added 5 packages

$ npm ci   (package.json now says demo-log ^2.1.0 but the lockfile has 2.0.1; exit code 1)
npm error code EUSAGE
npm error
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Invalid: lock file's demo-log@2.0.1 does not satisfy demo-log@2.1.0

Before npm ci, ci-in-sync/node_modules held a stale-leftover folder. Afterwards it holds:
  demo-lint, demo-log, demo-ui, demo-utils

Did any package come from somewhere other than the local registry? false
```

A failing `npm ci` is a feature. It tells your CI that somebody changed `package.json` and forgot to commit the updated lockfile.

For a production server you usually do not want test tools. Skip `devDependencies` with `npm ci --omit=dev` (the older `--production` flag is deprecated). npm also leaves out dev dependencies when the environment variable `NODE_ENV` is `production`. A test install with `NODE_ENV=production` left the dev-only package out.

> **Interview tip:** "`npm install` resolves and may change the lock. `npm ci` installs exactly what the lock says, deletes `node_modules` first, and fails on any mismatch. Use `npm ci` in CI and in Docker builds."

A typical Docker build (an illustrative snippet, not run in this lesson) copies the two dependency files first:

```dockerfile
FROM node:24
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "src/server.js"]
```

Docker remembers each step. The install step only runs again when `package.json` or the lockfile changed, so editing your source code does not trigger a slow reinstall.

## 8. node_modules, hoisting and the phantom dependency problem
How does `require('demo-utils')` find a folder? Node looks for `node_modules/demo-utils` in the folder of the file that calls `require`, then in the parent folder, then in its parent, and so on up to the root of the drive. **The nearest match wins.**

Node also checks the `NODE_PATH` environment variable and a few old global folders such as `~/.node_modules`. They are rarely used, but they can make a "missing" package appear to work on one machine only.

Example [05-how-node-finds-packages.js](examples/05-how-node-finds-packages.js) builds the layout from the last section by hand and asks Node:

```js
const requireFrom = (dir) => createRequire(path.join(tmp, dir, 'index.js'));
const version = (dir, name) => `${name}@${requireFrom(dir)(name).version}`;
console.log('from app/node_modules/demo-ui  ->', version(ui, 'demo-utils'));
```

```text
1. Where does require("demo-ui") look when called from app/ ? (only folders inside our temp dir)
   1. <temp dir>/app/node_modules
   2. <temp dir>/node_modules
   ...then the node_modules of every parent folder, up to the drive root.

2. The nearest node_modules wins:
   from app/                      -> demo-utils@2.1.0
   from app/node_modules/demo-ui  -> demo-utils@1.4.0 (its own nested copy)
   from app/node_modules/demo-log -> demo-utils@2.1.0 (the hoisted copy)

3. Phantom dependency: app never listed demo-utils, yet this works:
   require("demo-utils") in app/ -> demo-utils@2.1.0

4. Why it is dangerous: after an upgrade npm may lay the tree out differently.
   require("demo-utils") in the upgraded app -> MODULE_NOT_FOUND
   Your code only worked by accident. The fix: list demo-utils in your own dependencies.
```

A **phantom dependency** (also called a ghost dependency) is a package your code imports but your `package.json` does not list. It works only because hoisting happened to put it where Node looks. It breaks when the tree changes: an upgrade, a different package manager, or a fresh install on another machine.

How to avoid it:
- List every package you import in your own `package.json`.
- Add a lint rule that checks imports against `package.json` (for example `import/no-extraneous-dependencies` from eslint-plugin-import).
- Use a strict package manager. pnpm only exposes your declared packages. npm also has an experimental `install-strategy=linked` mode with a pnpm-like layout.

A related problem is the **duplicate copy**. In the tree above there are two `demo-utils`. That is fine until a library checks `instanceof` or keeps a singleton (one shared object), and two copies disagree. `npm ls demo-utils` shows every copy and `npm dedupe` merges copies when the ranges allow it.

> **Interview tip:** "What is a phantom dependency?" A strong answer: "A package my code imports but my `package.json` does not declare. It works only because hoisting put it in a folder Node searches, so it can disappear after an upgrade or on another package manager. I declare every import, add a lint rule, or use pnpm, which only shows a project the packages it declared."

## 9. How Node picks the file: main, exports, type and bin
Once Node finds the package *folder*, `package.json` decides which *file* to load. The second half of example 05 builds two small packages and loads them:

- `demo-old` has only `"main": "lib/main.js"`.
- `demo-modern` has `"main"` (for old tools) and an `exports` map:

```json
{
  "name": "demo-modern",
  "main": "./legacy.js",
  "exports": {
    ".": { "import": "./esm/index.mjs", "require": "./cjs/index.cjs" },
    "./feature": "./lib/feature.js"
  }
}
```

```text
5. "exports" (new) versus "main" (old), seen from a CommonJS file:
   require("demo-modern")                -> CommonJS build
   require("demo-modern/feature")        -> feature
   require("demo-modern/lib/secret.js")  -> ERR_PACKAGE_PATH_NOT_EXPORTED
   require("demo-old")                   -> main file
   require("demo-old/lib/other.js")      -> other file
   ...and from an ES module file:
   import { kind } from "demo-modern"    -> ESM build

6. "type" in package.json. What is typeof require inside a .js file?
   "type": "commonjs" -> function
   "type": "module"   -> undefined
```

What to learn from this:
- **`exports` is a public door.** Only the listed paths can be loaded. Everything else, such as `lib/secret.js`, fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. With only `main`, any file inside the package can be imported, and people will depend on your internals.
- **Conditions pick a file per loader.** `import` is used by `import` and `import()`, `require` by `require()`. Conditions are checked in order and the first match wins, so put `default` last.
- **`exports` beats `main`.** `main` stays only as a fallback for old tools.
- **`type`** controls how `.js` files are read. `"module"` means ES modules (no `require`, no `__dirname`), `"commonjs"` is the default. `.mjs` is always ESM and `.cjs` is always CommonJS (details in lesson 03).
- **`bin`** maps command names to files. The file should start with `#!/usr/bin/env node`. When the package is installed, npm creates links in `node_modules/.bin`. On Windows these are small `.cmd` and `.ps1` files (plus a shell script for Git Bash), on macOS and Linux a symlink.

Lesson 03 ([section 15](../03-modules/README.md)) goes further into `exports`: subpath patterns such as `"./util/*"`, the `imports` field for private `#` aliases, and the dual package hazard (two copies of one package loaded at once).

> **Interview tip:** "What is the difference between `main` and `exports`?" A strong answer: "`main` is one entry file. `exports` is a map of public entry points. It can pick a different file for `import` and `require`, and it blocks every path that is not listed. If both are present, `exports` wins and `main` is a fallback for old tools."

> **Common mistake:** Adding `exports` to an existing library and forgetting that it blocks every deep import (`your-lib/lib/util.js`) that users already rely on. Adding `exports` is usually a breaking change, so release it as a new major version.

## 10. The kinds of dependency
Example [09-dependency-kinds.js](examples/09-dependency-kinds.js) installs small projects from the pretend registry with real npm, one project per idea. All of them run at the same time. The short rules first:

| Field | Installed for | Who needs it |
|---|---|---|
| `dependencies` | everyone who installs your package | your code at run time |
| `devDependencies` | only when working on *your* project | tests, linters, build tools |
| `peerDependencies` | must be provided by the host project | plugins that extend a host library |
| `optionalDependencies` | if it works; skipped if its install fails | nice-to-have, platform-specific add-ons |

### dependencies vs devDependencies
When someone installs `your-lib`, npm installs `your-lib`'s `dependencies` and never its `devDependencies`. So:
- A package your code `require`s at run time belongs in `dependencies`. Put it in `devDependencies` and a production install (`npm ci --omit=dev`) leaves it out, and the app crashes with `MODULE_NOT_FOUND`.
- Things used only to build or test (`typescript`, `eslint`, a test runner) belong in `devDependencies`.
- For an application that is deployed as a whole (not published), the split mostly decides what the production image contains. Keep the production install small.

```text
devDependencies are skipped with --omit=dev (what you want on a production server)
  $ npm install --omit=dev   (exit code 0)
  node_modules now holds: demo-log, demo-ui, demo-utils
```

### peerDependencies
A peer dependency says: "I work *with* this package, but you must install it yourself". It is used by plugins (a Babel plugin needs Babel, a React component library needs React) so that there is only one copy of the host. Since npm 7, npm installs missing peers automatically and reports a conflict when it cannot satisfy them.

```text
peerDependencies: demo-plugin needs demo-ui 2.x but the project uses 1.x
  $ npm install   (exit code 1)
  npm error ERESOLVE unable to resolve dependency tree
  npm error Found: demo-ui@1.3.0
  npm error Could not resolve dependency:
  npm error peer demo-ui@"^2.0.0" from demo-plugin@1.0.0
  npm error Fix the upstream dependency conflict, or retry this command with --force or --legacy-peer-deps to accept an incorrect (and potentially broken) dependency resolution.
  node_modules now holds: (no node_modules folder)

peerDependencies: only the plugin is listed, and npm 7+ installs the host for you
  $ npm install   (exit code 0)
  node_modules now holds: demo-plugin, demo-ui, demo-utils
```

`ERESOLVE` is the error every developer meets. The honest fix is to upgrade or downgrade so the ranges agree. `--legacy-peer-deps` makes npm ignore peers (the behaviour of npm 3 to 6), and `--force` pushes on anyway. Both hide a real mismatch, so use them knowingly. `peerDependenciesMeta` lets you mark a peer as optional.

### optionalDependencies
If an optional package fails to install (for example a native add-on, which is C or C++ code that must be compiled for your machine, and the compiler is missing), npm skips it and carries on. Your code must handle its absence, usually with `try { require(...) } catch`.

```text
optionalDependencies: demo-fancy fails to install, and npm carries on without it
  $ npm install   (exit code 0)
  node_modules now holds: (empty)
```

The failure is silent at the default log level. Run with `--loglevel verbose` to see "reify failed optional dependency". The lockfile still records the package:

```text
The optional install failed silently. In the lockfile it is still recorded:
  demo-fancy optional: true, hasInstallScript: true
```

### engines
`engines` states which Node (and npm) versions a package supports. By default it is only a *warning*. With `engine-strict=true` (or `--engine-strict`) npm refuses.

```text
engines: demo-future wants Node >=99. By default that is only a warning
  $ npm install   (exit code 0)
  npm warn EBADENGINE   package: 'demo-future@1.0.0',
  npm warn EBADENGINE   required: { node: '>=99.0.0' },
  node_modules now holds: demo-future

...with --engine-strict the install is refused
  $ npm install --engine-strict   (exit code 1)
  npm error code EBADENGINE
  npm error engine Not compatible with your version of node/npm: demo-future@1.0.0
  npm error notsup Not compatible with your version of node/npm: demo-future@1.0.0
  npm error notsup Required: {"node":">=99.0.0"}
  node_modules now holds: (no node_modules folder)
```

(npm also has a `devEngines` field that checks the tools of the person working *on* the project. `engines` is about who *uses* it.)

### overrides
`overrides` in the **root** `package.json` forces a version anywhere in the tree. It is the tool for "a package deep inside my dependencies has a security bug, and its author has not released a fix yet". Overrides in installed dependencies are ignored.

```text
overrides: force demo-utils 2.0.0 everywhere, even where demo-ui asks for ^1.0.0
  $ npm install   (exit code 0)
  node_modules now holds: demo-log, demo-ui, demo-utils

Lockfile paths in the "overrides" project (one demo-utils, no nested copy):
  node_modules/demo-log 2.0.1
  node_modules/demo-ui 1.3.0
  node_modules/demo-utils 2.0.0
```

The conflict from section 5 is gone: one `demo-utils` for everybody. The price is that `demo-ui@1.3.0` now runs against a `demo-utils` major version it was never tested with. Use overrides sparingly and test afterwards. Overrides can also be scoped (`"overrides": { "demo-ui": { "demo-utils": "2.0.0" } }`) and can point at a direct dependency's range with `"$name"`. Yarn calls the same idea `resolutions`.

> **Interview tip:** "dependencies vs devDependencies vs peerDependencies" is a favourite. Say who the *consumer* is for each: runtime code, your own tooling, or the host project that must supply the package.

## 11. npm scripts
`"scripts"` holds named commands. `npm run <name>` runs one. Before it starts, npm adds `node_modules/.bin` to the front of `PATH`, so a script can call a locally installed tool (`eslint .`, `tsc`) by its plain name without installing it globally.

Scripts run through the platform shell: `sh` on macOS and Linux, `cmd.exe` on Windows (the `script-shell` setting can change that). A script is one command line. Chain steps with `&&` (it works in both shells). To run steps at the same time you need a helper such as `concurrently` or `npm-run-all`.

Handy to know:
- `npm run` with no name lists the scripts of the project.
- `npm run name --if-present` exits quietly with code 0 when the script does not exist. Without the flag, a missing script is an error (`Missing script: "name"`). This is useful in a generic CI file.
- `npm run name --silent` (short: `-s`) hides npm's own `> name@1.0.0 build` banner lines, so only the output of your script remains.
- `npm test` is short for `npm run test` (also `npm t`), and `npm start` is short for `npm run start`.

Example [06-npm-scripts.js](examples/06-npm-scripts.js) creates a project and runs real npm offline. First, **hooks**: scripts that npm runs automatically before and after another script, so you can add a clean-up or a check without touching the main script. For any script `name`, npm also runs `prename` before it and `postname` after it:

```text
$ npm run build
> scripts-demo@2.5.0 prebuild
> node scripts/say.js prebuild

  [prebuild]

> scripts-demo@2.5.0 build
> node scripts/say.js build

  [build]

> scripts-demo@2.5.0 postbuild
> node scripts/say.js postbuild

  [postbuild]
```

Some names are special and run automatically at certain moments (all of them also have `pre` and `post` versions where it makes sense):

| Script | Runs |
|---|---|
| `npm test`, `npm start`, `npm stop`, `npm restart` | the script of that name. `npm start` falls back to `node server.js` if you have no `start` script but a `server.js` file |
| `preinstall`, `install`, `postinstall` | in each *dependency* while installing it, and in your own project on a local `npm install` |
| `prepare` | after a local `npm install` with no arguments, and before the package is packed or published. The place to build |
| `prepublishOnly` | only on `npm publish`, before packing |
| `prepack`, `postpack` | around creating the tarball |
| `preversion`, `version`, `postversion` | around `npm version` |

The order for `npm publish` is: `prepublishOnly`, `prepack`, `prepare`, `postpack`, `publish`, `postpublish`.

### Passing arguments: the -- rule
Everything after a lone `--` goes to your script. Without it, npm reads the flag itself:

```text
$ npm run args -- --port 3000 --verbose
> scripts-demo@2.5.0 args
> node scripts/args.js --port 3000 --verbose

  the script received: ["--port","3000","--verbose"]

$ npm run args --port 3000
> scripts-demo@2.5.0 args
> node scripts/args.js 3000

  the script received: ["3000"]
npm warn "3000" is being parsed as a normal command line argument.
npm warn Unknown cli config "--port". This will stop working in the next major version of npm.
```

In the second run npm swallowed `--port` as its own config. The script got only `3000`. (The two `npm warn` lines are from npm 11.13 and their wording changes between npm versions. The rule does not: flags before `--` belong to npm.)

### The environment of a script
npm sets a few variables, and puts `node_modules/.bin` first in `PATH`:

```text
$ npm run info
> scripts-demo@2.5.0 info
> node scripts/info.js

  npm_package_name    = scripts-demo
  npm_package_version = 2.5.0
  npm_lifecycle_event = info
  first folder in PATH = <project>/node_modules/.bin
```

Older npm versions also exported every `package.json` field as `npm_package_*`. npm 7 and newer do not. Read `package.json` yourself (its path is in `npm_package_json`).

> **Interview tip:** "How can a script call `eslint` when it is not installed globally?" A strong answer: "Before a script starts, npm puts `node_modules/.bin` at the front of `PATH`. Every package that declares a `bin` gets a link there, so the plain command name works, and it runs the version from the lockfile."

### Cross-platform pitfalls
Scripts that work on your Mac can fail on a Windows teammate's machine, because `cmd.exe` is not `sh`. This line only works with a POSIX shell:

```text
$ npm run posix-only
> scripts-demo@2.5.0 posix-only
> FOO=bar node scripts/say.js posix
'FOO' is not recognized as an internal or external command,
operable program or batch file.
(npm exited with code 1 because the script failed)
```

(That output is from Windows. On macOS and Linux this script works.) Common traps and fixes:

| Trap | Fix |
|---|---|
| `FOO=bar node app.js` (set a variable for one command) | use a package like `cross-env`, or put values in a file and use `node --env-file=.env app.js` |
| `rm -rf dist`, `cp`, `mkdir -p` | write a small Node script, or use a cross-platform tool such as `rimraf` |
| `$HOME` versus `%HOME%` | avoid shell variables in scripts; read `process.env` in Node |
| single quotes around arguments | use double quotes (escaped in JSON as `\"`); `cmd.exe` does not understand single quotes |
| globs like `src/**/*.js` expanded by the shell | quote them and let the tool expand them |
| `&&` to chain commands | works in both shells; `;` and `&` do not mean the same everywhere |

### ignore-scripts and node --run
Two details that surprise people. With `--ignore-scripts` (or the config `ignore-scripts=true`) npm still runs a script you name explicitly, but it skips its `pre` and `post` hooks as well as all install scripts. And Node itself can run scripts since Node 22 with `node --run <name>`. It is simpler, because there is no npm program to start, but it is **not** npm:

```text
$ npm run build --ignore-scripts
> scripts-demo@2.5.0 build
> node scripts/say.js build

  [build]

$ node --run build
  [build]

$ node --run who
  npm_lifecycle_event = undefined
  NODE_RUN_SCRIPT_NAME = who

node --run ran only the named script (no prebuild or postbuild) and set no npm_* variables.
```

`node --run` also puts `node_modules/.bin` on `PATH`. It sets `NODE_RUN_SCRIPT_NAME` and `NODE_RUN_PACKAGE_JSON_PATH` instead of the `npm_*` variables.

> **Common mistake:** Putting a build step in `prepublish`. That name is deprecated and confusing: it runs on `npm install` and `npm ci`, but not on `npm publish`. Use `prepare` (build for local use and before publishing) or `prepublishOnly` (only on publish).

## 12. Running tools: local, global, npx and npm exec
There are three places a command-line tool can live:

1. **Local to the project** (`devDependencies`, binary in `node_modules/.bin`). The default choice, because the version is pinned in the lockfile and every teammate gets the same one.
2. **Global** (`npm install -g tool`). One copy for your whole machine. Fine for tools you use everywhere, but versions drift between machines, and CI does not have it.
3. **Not installed at all**: `npx tool` runs it from the local `node_modules/.bin` if present. Otherwise it downloads the package into a temporary cache and runs it, after asking you to confirm (`--yes` skips the question and `--no` refuses to download; without a terminal, as in CI, `--yes` is assumed).

`npx` and `npm exec` are two spellings of the same engine. A downloaded tool runs with your user's rights, so check the name for typos before you confirm (section 18 explains look-alike names). The `--` separates npm's options from the command:

```text
$ npm exec -- demo-cli --hello
demo-cli ran with [ '--hello' ]
```

> **Interview tip:** "Why not install everything globally?" Because global tools are invisible to the project: another developer or the CI server will not have them, and different projects may need different versions. Put tools in `devDependencies` and call them from scripts or with `npx`.

## 13. Global installs and npm link
`npm install --global pkg` (short: `-g`) puts the package in npm's **global folder** and creates command files on your `PATH`. Example [12-config-global-link-workspaces.js](examples/12-config-global-link-workspaces.js) does this in a sandbox global folder, so your real one is untouched:

```text
2. Global install (npm install --global demo-cli) went to the sandbox, not to your real global folder:
   global packages: demo-cli
   command files  : demo-cli, demo-cli.cmd, demo-cli.ps1 (these put demo-cli on your PATH)
```

Those three files are what Windows gets (a shell script, a `.cmd` file and a PowerShell script). On macOS and Linux npm makes a symlink in the global `bin` folder instead. The folder layout differs too (from npm's own docs): on Windows the prefix is usually `%AppData%/npm`, packages go to `<prefix>/node_modules` and command files sit directly in `<prefix>`. On macOS and Linux packages go to `<prefix>/lib/node_modules` and commands to `<prefix>/bin`. `npm prefix -g` and `npm root -g` print the global locations on your machine. Avoid `sudo npm install -g`; if the default folder needs admin rights, change the `prefix` setting (section 16) to a folder you own.

### npm link
`npm link` is for developing a library and an app at the same time without publishing. It replaces the installed copy in the app with a **symlink** (a folder alias) to your working copy.

```bash
cd ../my-lib
npm link                # the classic two-step way: register my-lib in the global folder
cd ../my-app
npm link my-lib         # point my-app/node_modules/my-lib at it
# or in one step, from the app folder:
npm link ../my-lib
```

```text
4. npm link: the consumer uses your working copy of tinylib
   consumer/node_modules/tinylib points to tinylib
   before editing tinylib/index.js: tinylib version ONE
   after editing tinylib/index.js : tinylib version TWO (no reinstall needed)
```

Gotchas: a linked library resolves *its own* dependencies from its own folder, so you can end up with two copies of a peer such as React. The next `npm install` in the app may remove the link. A `file:../my-lib` dependency or a workspace (next section) is often a calmer choice.

> **Interview tip:** "How do you try a library change in a real app before you publish it?" A strong answer: "`npm link` for quick edits. For the most realistic test I run `npm pack` in the library and install the resulting `.tgz` in the app, because that file contains exactly what users will get."

## 14. Workspaces: monorepos in brief
A **monorepo** keeps several packages in one repository. npm **workspaces** make that work: the root `package.json` lists folders, and one `npm install` at the root installs everything and *links* the local packages into the root `node_modules`.

```json
{ "name": "mono", "private": true, "workspaces": ["packages/*"] }
```

```text
3. Workspaces: one install at the root, local packages linked into node_modules
   mono/node_modules/lib-a is a link?    true
   ...and it points to                   mono/packages/lib-a
   app-b requires lib-a and gets         "hi from lib-a"
   npm run hello --workspaces printed    hello from app-b | hello from lib-a
```

Useful flags: `-w <name>` runs a command in one workspace, `--workspaces` in all of them, `--include-workspace-root` adds the root. For example `npm install lodash -w packages/app` adds a dependency to one workspace only. There is a single `package-lock.json` at the root. Shared dependencies are hoisted across packages. Tools such as Turborepo or Nx build on top of workspaces to add task ordering and caching. Yarn and pnpm have their own workspace support too.

> **Interview tip:** "Why use workspaces?" A strong answer: "One repository, one install and one lockfile. Local packages are linked instead of published, so a change in a library shows up in the app immediately, and shared dependencies are installed once."

## 15. Publishing: pack, publish and the tarball
Publishing means: build a tarball from your folder and upload it to the registry. The usual flow:

```bash
npm login                   # you need an account; turn on two-factor authentication
npm version minor           # bump, commit and tag (inside a git repo)
npm pack --dry-run          # LOOK at what would be published
npm publish                 # add --access public for a scoped package; --tag next for a prerelease
```

The tarball is a gzip-compressed tar archive in which every path starts with `package/`. The helper `examples/_tarball.js` builds one by hand in a few lines, and examples 08 to 12 serve such tarballs from the pretend registry. `npm pack` writes `name-version.tgz` into the current folder. For a package named `p4` at version 1.1.0:

```text
$ npm pack
p4-1.1.0.tgz
```

(`npm pack` also prints the file list, sizes and the `integrity` hash on stderr.) **What goes in?** Example [07-pack-tarball.js](examples/07-pack-tarball.js) uses `npm pack --dry-run --json` on four copies of the same project. Each has `src/`, `test/`, `README.md`, `LICENSE`, `CHANGELOG.md`, a private `notes.txt` and a `.env` file, but different rules:

```text
A. "files": ["src"] in package.json (a whitelist)
  5 files: LICENSE  README.md  package.json  src/index.js  src/internal/debug.js

B. no "files", but a .npmignore (a blacklist)
  5 files: CHANGELOG.md  LICENSE  README.md  package.json  src/index.js

C. no "files", no .npmignore, only a .gitignore
  7 files: CHANGELOG.md  LICENSE  README.md  package.json  src/index.js  src/internal/debug.js  test/index.test.js
  npm warn gitignore-fallback No .npmignore file found, using .gitignore for file exclusion. Consider creating a .npmignore file to explicitly control published files.

D. nothing at all (the dangerous default)
  9 files: .env  CHANGELOG.md  LICENSE  README.md  notes.txt  package.json  src/index.js  src/internal/debug.js  test/index.test.js
  DANGER: private files would be published: .env, notes.txt

Always in the tarball: package.json, README, LICENSE, the "main" file and "bin" files.
Never in the tarball: node_modules, package-lock.json, .git and .npmrc.
```

The rules, in plain words:
- With **`files`** you list what to include (a whitelist). This is the safest choice, because a new secret file is excluded by default.
- Without `files`, npm includes everything except an ignore list. It uses **`.npmignore`** if you have one, otherwise your **`.gitignore`**. A root `.npmignore` does not override `files`. If you have neither, as in scenario D, your `.env` is published.
- Always included: `package.json`, README, LICENSE and the files named by `main` and `bin`. Never included: `node_modules`, `.git`, `.npmrc`, `package-lock.json` and other lockfiles.
- The `.gitignore` fallback is documented npm behaviour. The warning text in scenario C is what npm 11.13 prints; other npm versions may word it differently or stay silent.

> **Common mistake:** Publishing without looking. Make `npm pack --dry-run` a habit, and prefer a `files` whitelist. People have published `.env` files with real keys this way.

> **Interview tip:** "`files` or `.npmignore`?" A strong answer: "`files` is a whitelist in `package.json`, `.npmignore` is a blacklist. I use `files`, because anything new is left out by default, and I check the result with `npm pack --dry-run`."

### Tags and bad releases
A **dist-tag** is a movable label that points to one published version. The tag `latest` is what a plain `npm install your-lib` installs. `npm publish --tag beta` gives the new version the tag `beta` and leaves `latest` where it was, so only people who ask for it (`npm install your-lib@beta`) receive it. Together with a prerelease version such as `1.0.1-beta.0` (section 3), this is how you test a release safely. `npm dist-tag ls your-lib` lists the tags, and `npm dist-tag add your-lib@1.2.0 next` moves one.

Once a version is published you cannot change it, and the name and version pair can never be reused. To retire a bad release, publish a fixed one and run `npm deprecate your-lib@1.2.0 "use 1.2.1"`. Anyone who installs the bad version then sees your warning. Read the registry's unpublish policy before you try to unpublish anything.

## 16. .npmrc, configuration and Corepack
npm reads settings from several places. From **highest priority** to lowest:

1. Command line flags (`--save-exact`)
2. Environment variables starting with `npm_config_` (`npm_config_save_exact=false`)
3. The **project** `.npmrc` (next to `package.json`)
4. The **user** `.npmrc` (`~/.npmrc`)
5. The **global** config file (`$PREFIX/etc/npmrc`)
6. npm's built-in config, then the defaults

A `.npmrc` is a plain `key=value` file (ini format, `#` or `;` for comments). Environment variables can be inserted with `${NAME}`. Example 12 puts `save-exact=true` and a registry for the `@acme` scope in a project `.npmrc`:

```text
1. Config layers (npm config get save-exact)
   project has .npmrc with save-exact=true      -> true
   another folder, no .npmrc                    -> false
   project + environment npm_config_save_exact  -> false (environment beats the file)
   ...and also --save-exact=true on the command -> true (command line beats environment)
   scoped registry for @acme packages           -> https://npm.acme.example/
```

What people put in `.npmrc`:

| Setting | Why |
|---|---|
| `registry=https://...` | use a company mirror or private registry |
| `@acme:registry=https://...` | packages in the `@acme` scope come from that registry (also the best defence against dependency confusion, section 18) |
| `save-exact=true` | `npm install` records exact versions instead of `^` ranges |
| `engine-strict=true` | refuse packages that do not support your Node |
| `ignore-scripts=true` | never run dependency install scripts |
| `legacy-peer-deps=true` | ignore peer dependencies (use knowingly) |
| `//registry.example.com/:_authToken=${NPM_TOKEN}` | log in to a private registry with a token that comes from the environment |

> **Common mistake:** Committing an `.npmrc` with a literal token. Use the `${NPM_TOKEN}` form so the secret lives in the CI settings, not in git. Never publish or share a file that holds a token.

Commands: `npm config get <key>`, `npm config set <key> <value>` (user file, or `--location=project`), `npm config list` and `npm config delete <key>`. `npm config get cache` shows the cache folder: `%LocalAppData%/npm-cache` on Windows and `~/.npm` on macOS and Linux.

> **Interview tip:** "How do you make the whole team use the same settings and the same package manager?" A strong answer: "Commit the lockfile and a project `.npmrc` (never with a literal token), set `engines` (with `engine-strict` if needed) and `packageManager`, and run `npm ci` in CI so any drift fails the build."

### Corepack and the packageManager field
Different developers using different package managers (or different versions of one) write different lockfiles and get different trees. The `packageManager` field names the one the project expects, for example `"packageManager": "pnpm@9.15.0"`.

**Corepack** is a small program that reads that field. After you turn it on once, typing `pnpm` or `yarn` in that project runs exactly the version that is named (Corepack downloads it the first time), and Corepack stops with an error if you use a different package manager from the one named.

```bash
corepack enable   # once per machine: installs small launcher files for yarn and pnpm
```

`corepack enable` writes next to the `node` binary, so on Windows it may need an administrator terminal. `corepack enable --install-directory <folder>` writes to another folder instead (put that folder on your `PATH`). Corepack is bundled with Node up to Node 24 (Node 24.16.0 includes Corepack 0.35.0), it does nothing until you enable it, and it is marked experimental. **Node 25 and newer no longer ship it**, so there you install it yourself (`npm install -g corepack`). Even without Corepack, the `packageManager` field is a useful note for people and for CI tools.

## 17. Checking your tree: ls, explain, outdated, audit
These commands answer "what do I have, and is it healthy?".

| Command | Answers |
|---|---|
| `npm ls` / `npm ls --all` | the installed tree (`--all` includes deep levels). `npm ls pkg` finds every copy of `pkg` |
| `npm explain pkg` (or `npm why pkg`) | *why* is this package here? Shows the chain of dependents |
| `npm outdated` | which packages are behind (exit code 1 when any are) |
| `npm audit` | known vulnerabilities in your tree (exit code non-zero when it finds some) |
| `npm audit fix` | upgrade within your ranges to fix them (`--force` allows major upgrades) |
| `npm audit signatures` | verify registry signatures and provenance of installed packages |
| `npm view pkg versions` | the versions the registry has |

Real output from example 08, on the demo project:

```text
$ npm explain demo-utils
demo-utils@1.4.0
node_modules/demo-ui/node_modules/demo-utils
  demo-utils@"^1.0.0" from demo-ui@1.3.0
  node_modules/demo-ui
    demo-ui@"^1.2.0" from the root project

demo-utils@2.1.0
node_modules/demo-utils
  demo-utils@"^2.0.0" from demo-log@2.0.1
  node_modules/demo-log
    demo-log@"~2.0.0" from the root project
```

`explain` shows both copies and the ranges that required them. Example [10-install-scripts-and-audit.js](examples/10-install-scripts-and-audit.js) shows `audit` and `outdated`. The pretend registry reports a made-up advisory for `demo-old` (the id and URL are fictional):

```text
5. npm audit (exit code 1: non-zero when it finds something)
   # npm audit report
   
   demo-old  1.0.0
   Severity: high
   Prototype pollution in demo-old - https://example.test/advisories/DEMO-0001
   fix available via `npm audit fix --force`
   Will install demo-old@2.0.0, which is a breaking change
   node_modules/demo-old
   
   1 high severity vulnerability
   
   To address all issues (including breaking changes), run:
     npm audit fix --force

6. npm outdated (exit code 1: 1 means something is behind "latest")
   Package   Current  Wanted  Latest  Location               Depended by
   demo-old    1.0.0   1.0.0   2.0.0  node_modules/demo-old  plain-install
```

How to read `outdated`: **Current** is what is installed, **Wanted** is the highest version your *range* allows (what `npm update` would install), **Latest** is the newest release. When Wanted and Latest differ you have a new major version waiting, and an upgrade needs a deliberate decision. `npm audit fix` without `--force` never crosses a major version.

> **Interview tip:** An `npm audit` report is a starting point, not a verdict. Many findings are in dev tools that never run in production, or in code paths you do not use. A good answer says: check whether the vulnerable code is reachable, upgrade when a fix exists within range, use `overrides` for a transitive package when it does not, and automate update pull requests (for example with Dependabot or Renovate).

## 18. Supply-chain security
When you run `npm install` you run other people's code, and so do the packages you install. The **supply chain** is everything between the author's keyboard and your `node_modules`. Typical attacks:

| Attack | How it works |
|---|---|
| **Typosquatting** | a malicious package with a name close to a popular one (`expresss`, `cross_env`). A famous case in 2017 was `crossenv` imitating `cross-env` |
| **Dependency confusion** | your company has an internal package `acme-utils`. An attacker publishes `acme-utils` with a higher version on the public registry. A badly configured client installs the public one |
| **Malicious install scripts** | a `postinstall` script runs with your user's rights and can read environment variables, files and SSH keys |
| **Account takeover** | a maintainer's account or token is stolen and a poisoned *new version* of a good package is published |
| **Abandoned or transferred packages** | an old package gets a new, untrusted owner |

### Install scripts really run
Example [10-install-scripts-and-audit.js](examples/10-install-scripts-and-audit.js) installs a package whose `postinstall` script reads environment variables that start with `DEMO_SECRET` (the value is a harmless fake, `not-a-real-secret`) and writes a file:

```text
1. npm install (default). npm prints "added 2 packages" and nothing about scripts.
   But the postinstall script ran, and left this file behind:
    ran during install; saw DEMO_SECRET_TOKEN

2. npm install --ignore-scripts. Was the postinstall script run? false

3. npm install --foreground-scripts shows what the script prints:
   > demo-native@1.0.0 postinstall
   demo-native postinstall is running. It can read: DEMO_SECRET_TOKEN

4. The lockfile marks packages that have install scripts: hasInstallScript on node_modules/demo-native
```

Since npm 7, install script output is hidden unless you pass `--foreground-scripts`, so you would not even see the script run. A real malicious script could send the value over the network. Mitigation: `npm install --ignore-scripts` (or `ignore-scripts=true` in `.npmrc`), then run `npm rebuild` only for packages you trust and that really need a build step (some native add-ons do). Remember from section 11 that `--ignore-scripts` also stops `pre` and `post` hooks of your own `npm run` scripts.

### Integrity, look-alike names and lockfile review
Example [11-supply-chain-checks.js](examples/11-supply-chain-checks.js) shows the building blocks in plain Node, with no npm at all:

```text
1. Integrity check (what npm does after every download)
   lockfile integrity : sha512-<88 base64 characters> (the exact value depends on the bytes)
   same tarball again : OK, same bytes as before
   tampered tarball   : EINTEGRITY, refuse to install (one changed file, a completely different hash)

2. Look-alike names (typosquatting)
   expresss     expresss is 1 edit(s) away from express
   lodahs       lodahs is 2 edit(s) away from lodash
   crossenv     crossenv is cross-env with different separators
   cross_env    cross_env is cross-env with different separators
   @evil/react  @evil/react borrows the name of react under another scope
   express      looks fine
   left-pad     looks fine
   chalk        looks fine

3. Lockfile review
   - demo-native: runs an install script (check what it does)
   - cool-helper: comes from example.test, not the usual registry
   - cool-helper: no integrity hash, nothing proves the bytes are the expected ones
   - mirror-lib: comes from packages.example.test, not the usual registry

4. A bad version appears
   range "^2.0.0", fresh install, no lockfile:        2.1.1 <- the bad one
   exact pin "2.1.0":                                 2.1.0
   lockfile entry 2.1.0, then npm ci:                 2.1.0 (a newer version is taken only after npm update)
   range "^2.0.0" with a 3-day cool-down:             2.1.0 (the idea behind npm min-release-age)
```

The integrity hash proves the bytes did not change *after* the lockfile was written. It cannot tell you that the version was good in the first place. That is why you review lockfile diffs, and why a lockfile plus `npm ci` beats a loose range: a poisoned release is only picked up when somebody runs `npm update`.

### A checklist you can say out loud
1. **Commit the lockfile and install with `npm ci`** in CI and deployments.
2. **Review dependency changes** in pull requests, including new `resolved` hosts and `hasInstallScript`.
3. **Run with `--ignore-scripts`** where you can, and allow scripts deliberately.
4. **Pin exact versions** for critical or rarely updated packages (`save-exact=true`). Two newer npm 11 settings (both documented in npm 11.13) shrink the attack surface further: `min-release-age` ignores versions that were published in the last N days, and `allow-git=none` refuses git dependencies.
5. **Scan and verify**: `npm audit` for known problems, `npm audit signatures` for registry signatures and provenance.
6. **Publish safely.**
   - Turn on two-factor authentication for your npm account.
   - Publish from CI with **provenance**, a signed statement of where and how a package was built. `npm publish --provenance` from a supported CI provider links the package to the repository and workflow that built it.
   - Prefer **trusted publishing**: the CI proves its identity to npm with OpenID Connect (a standard way for one service to prove who it is to another), so no long-lived token sits in your secrets. The `npm trust` command in npm 11.10 and newer sets it up.
   - Keep tokens short-lived and narrow.
7. **Use scopes and private registries** for internal packages (`@acme:registry=...`) to avoid dependency confusion.
8. **Depend on less.** Node now has built-ins for many jobs: `fetch` (simple HTTP calls), `node --watch` (instead of nodemon), `node --env-file` (instead of dotenv), `crypto.randomUUID()` (instead of the uuid package for v4 ids), `util.parseArgs` (simple CLI flags), `fs.rm` with `recursive` (instead of rimraf), `structuredClone`. Each avoided dependency is one less thing to trust.

> **Interview tip:** "How would you secure the dependencies of a Node service?" Structure the answer as prevent, detect, respond: lockfile + `npm ci` + reviewed updates + no install scripts (prevent), `npm audit` + signature checks + alerts (detect), and overrides + quick rollback via the lockfile in git (respond).

## 19. Interview question bank
Short answers you can say out loud. The number in brackets is the section with the full explanation.

### Classic questions
**What is npm?** Three things: the public registry, the command line tool and a package manager. Yarn and pnpm use the same registry and the same `package.json` (section 1).

**What does `npm install` do, step by step?** It reads `package.json` and the lockfile, picks versions that fit the ranges, builds the tree, downloads the tarballs and verifies their hashes, unpacks them into `node_modules` (hoisting shared packages), links binaries into `.bin`, runs install scripts and writes the lockfile (section 5).

**`dependencies` or `devDependencies`?** Whatever the running program needs is a dependency. Whatever only builds, tests or lints is a devDependency. People who install your library never get your devDependencies (section 10).

**`^1.2.3` versus `~1.2.3`?** Caret allows minor and patch updates (below `2.0.0`), tilde only patch updates (below `1.3.0`). For `0.x` the caret is stricter (section 4).

**Why commit the lockfile? `npm install` or `npm ci` in CI?** The lockfile makes installs repeatable. `npm ci` installs exactly what it says and fails when it disagrees with `package.json` (sections 6 and 7).

**What is a phantom dependency?** A package you import but never declared. It works because of hoisting and breaks when the tree changes (section 8).

**What is a peer dependency?** A package the host project must supply, so that a plugin and its host share one copy. npm 7 and newer installs it automatically and raises `ERESOLVE` on a conflict (section 10).

**What is the difference between `main` and `exports`?** `main` is one entry file. `exports` maps public entry points per loader and blocks everything not listed (section 9).

**How do you run something before and after a script?** Add `prename` and `postname` scripts. `--ignore-scripts` and `node --run` skip them (section 11).

**Global or local install?** Local, in `devDependencies`. The version is then pinned by the lockfile and every machine has it (section 12).

**What ends up in the published tarball?** With a `files` whitelist: those files plus `package.json`, README and LICENSE. Without it: nearly everything, including a stray `.env`. Check with `npm pack --dry-run` (section 15).

**How do you protect a project from a bad dependency?** Prevent (lockfile, `npm ci`, `--ignore-scripts`, reviewed updates), detect (`npm audit`, signature checks) and respond (`overrides`, roll back through the lockfile in git) (section 18).

### Scenario questions
These are the follow-ups that separate "I have used npm" from "I understand npm".

**"It works on my machine, but CI fails with `MODULE_NOT_FOUND`."** Typical causes: the package sits in `devDependencies` and CI installs with `--omit=dev`; it is a phantom dependency that your machine happens to have; a global install or `NODE_PATH` on your machine hides the problem; or a file name differs only in letter case, which Windows and macOS forgive but Linux does not. Reproduce with `npm ci --omit=dev` in a clean folder, and use `npm explain <package>`.

**"`npm install` fails with `ERESOLVE`."** Read the message: it names the package that wants a peer version and the version you have. Upgrade or downgrade so the ranges agree. `--legacy-peer-deps` and `--force` only hide the mismatch. Use them knowingly, and note why.

**"A deep dependency has a critical vulnerability and its parent has no fix yet."** Find the path with `npm audit` and `npm explain`. Check whether the vulnerable code can run in your app. If a fixed version fits the range, `npm update` it. If not, pin the fixed version with `overrides` in the root `package.json`, test, and remove the override when the parent catches up.

**"Two copies of a library are loaded and `instanceof` returns false."** Run `npm ls <package>` to see the copies. Align the ranges and run `npm dedupe`. For a plugin and its host library, make the host a `peerDependency`. As a last resort force one version with `overrides`.

**"A dependency broke production overnight and nobody changed any code."** The build probably ran `npm install` without a committed lockfile, so a range picked up a new release. Commit the lockfile, build with `npm ci`, and roll back by reverting the lockfile. For extra safety use exact versions for critical packages or `min-release-age`.

**"How do you keep dependencies up to date without breaking things?"** Run `npm outdated` regularly, or let Dependabot or Renovate open pull requests. Update in small batches, read the changelog before a major bump, let CI run the tests, and read the lockfile diff in review.

**"The lockfile has a merge conflict."** Resolve `package.json` first. Then run `npm install` and let npm regenerate the lockfile. Do not edit the lockfile by hand.

## Summary / Key takeaways
- npm is a registry, a CLI and a package manager. Yarn and pnpm use the same registry; they differ in layout and lockfile.
- `package.json` declares ranges. Semver (`MAJOR.MINOR.PATCH`) says what a version bump promises. `^` allows minor and patch updates, `~` only patch updates.
- `package-lock.json` records the exact tree and tarball hashes. Commit it. Use `npm ci` in CI and deployments.
- Hoisting puts shared packages high in `node_modules`. Anything you import must be in your own `package.json`, or you have a phantom dependency.
- `exports` is the public door of a package and beats `main`. `type` decides how `.js` files are read.
- `dependencies` run in production, `devDependencies` build and test, `peerDependencies` come from the host, `optionalDependencies` may fail quietly. `engines` is only a warning unless `engine-strict` is on.
- Scripts run through `sh` or `cmd.exe`, support `pre` and `post` hooks and need `--` to pass flags. `--ignore-scripts` and `node --run` skip hooks.
- Packages run code on install. Defend with lockfiles, `--ignore-scripts`, review, `npm audit`, provenance, two-factor authentication and fewer dependencies.

## Quick check
1. What is the difference between `dependencies` and `devDependencies`, and which one does a consumer of your library install?
<details><summary>Answer</summary>

`dependencies` are needed at run time, `devDependencies` only to build, test or lint your project. When someone installs your library, npm installs your `dependencies` (and satisfies your peers) but never your `devDependencies`.

</details>

2. Which versions does `^1.4.2` allow? And `^0.4.2`? And `~1.4.2`?
<details><summary>Answer</summary>

`^1.4.2` is `>=1.4.2 <2.0.0`. `^0.4.2` is `>=0.4.2 <0.5.0` (for `0.x` the minor number acts like a major). `~1.4.2` is `>=1.4.2 <1.5.0`.

</details>

3. Why should an application commit `package-lock.json`?
<details><summary>Answer</summary>

Ranges move over time. The lockfile freezes the exact version of every package in the tree, with download URLs and integrity hashes. Developers, CI and production then install identical code, and a new (possibly bad) release is only taken when someone updates on purpose.

</details>

4. When do you use `npm ci` instead of `npm install`?
<details><summary>Answer</summary>

In CI, Docker builds and deployments. `npm ci` needs a lockfile, deletes `node_modules` first, installs exactly what the lock says, never writes `package.json` or the lock, and fails if they disagree. `npm install` is for changing dependencies on your own machine.

</details>

5. What is a phantom dependency, and how do you prevent it?
<details><summary>Answer</summary>

A package you import without listing it in your `package.json`. It works only because another package pulled it in and hoisting placed it where Node looks. Prevent it by declaring every import, adding a lint rule such as `import/no-extraneous-dependencies`, or using pnpm, which does not expose undeclared packages.

</details>

6. You run `npm run build --watch` and your script never sees `--watch`. Why, and what is the fix?
<details><summary>Answer</summary>

npm reads `--watch` as one of its own options. Put `--` before the arguments you want to pass: `npm run build -- --watch`.

</details>

7. Does `npm run build --ignore-scripts` run `prebuild` and `postbuild`? Does `node --run build`?
<details><summary>Answer</summary>

No to both. With `--ignore-scripts` npm runs only the script you named. `node --run build` also runs only that script (and sets no `npm_*` variables).

</details>

8. A project has no `files` field, no `.npmignore` and no `.gitignore`. What does `npm publish` upload?
<details><summary>Answer</summary>

Everything except npm's fixed ignore list (`node_modules`, `.git`, `.npmrc`, lockfiles and similar). That includes `.env`, test files and private notes, which is why you should use a `files` whitelist and run `npm pack --dry-run` first.

</details>

9. A dependency has a `postinstall` script. Why is that a security concern, and what can you do?
<details><summary>Answer</summary>

Install scripts run automatically with your user's rights and can read environment variables and files (npm 7+ even hides their output). Use `npm install --ignore-scripts` or `ignore-scripts=true`, run `npm rebuild` only for packages you trust, review lockfile changes, and prefer packages without install scripts.

</details>

10. What does the `exports` field do that `main` cannot?
<details><summary>Answer</summary>

It maps several public entry points, can pick a different file for `import` and `require`, and blocks every path that is not listed. Loading an unlisted file such as `pkg/lib/secret.js` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

</details>

## Try it yourself
Run these from the repo root. Save each solution as a scratch file (any name, any folder) and run it with `node`. Tasks 2 and 3 use paths relative to the repo root.

### Task 1 (easy): a package.json linter
Write `lint(pkg)` that returns a list of problems for a package.json object. Report: any range that accepts everything (`*`, `x`, `latest` or an empty string), a package listed in both `dependencies` and `devDependencies`, a missing `license`, and a missing `engines.node`. Try it on this object:

```js
const pkg = {
  name: 'shop-api',
  version: '1.0.0',
  dependencies: { express: '*', lodash: 'latest', pg: '^8.11.0', chalk: '^5.0.0' },
  devDependencies: { chalk: '^5.0.0', eslint: '^9.0.0' },
};
```

<details><summary>Hint</summary>

Loop over `Object.entries({ ...dev, ...prod })` for the ranges. For the duplicate check, test `name in dev` for every key of `prod`. For `engines`, use `pkg.engines && pkg.engines.node`.

</details>

<details><summary>Solution</summary>

```js
'use strict';

const pkg = {
  name: 'shop-api',
  version: '1.0.0',
  dependencies: { express: '*', lodash: 'latest', pg: '^8.11.0', chalk: '^5.0.0' },
  devDependencies: { chalk: '^5.0.0', eslint: '^9.0.0' },
};

function lint(pkg) {
  const problems = [];
  const prod = pkg.dependencies || {};
  const dev = pkg.devDependencies || {};

  for (const [name, range] of Object.entries({ ...dev, ...prod })) {
    if (['', '*', 'x', 'latest'].includes(range.trim())) {
      problems.push(`${name}: the range "${range}" accepts any version, even a breaking one`);
    }
  }
  for (const name of Object.keys(prod)) {
    if (name in dev) problems.push(`${name}: listed in both dependencies and devDependencies`);
  }
  if (!pkg.license) problems.push('no "license" field');
  if (!(pkg.engines && pkg.engines.node)) problems.push('no "engines.node" field');
  return problems;
}

const problems = lint(pkg);
problems.forEach((p) => console.log('-', p));
console.log(problems.length, 'problems found');
```

Output:

```text
- express: the range "*" accepts any version, even a breaking one
- lodash: the range "latest" accepts any version, even a breaking one
- chalk: listed in both dependencies and devDependencies
- no "license" field
- no "engines.node" field
5 problems found
```

</details>

### Task 2 (medium): your own `npm outdated`
Given what is published, the ranges from `package.json` and the versions in the lockfile, print a table of **Current**, **Wanted** and **Latest** for every package that is behind, and warn when Latest is a new major version. Reuse the mini semver code from this lesson (`require` it with a path built from the repo root).

```js
const published = {
  express: ['4.18.2', '4.21.2', '5.0.0', '5.1.0', '5.2.0-beta.1'],
  lodash: ['4.17.20', '4.17.21'],
  pg: ['8.11.0', '8.11.5', '8.16.0'],
};
const wantedRanges = { express: '^4.18.0', lodash: '~4.17.0', pg: '^8.11.0' }; // package.json
const installed = { express: '4.18.2', lodash: '4.17.21', pg: '8.11.0' }; // lockfile
```

<details><summary>Hint</summary>

Wanted is `maxSatisfying(published[name], range)`. Latest is the highest version without a `-` (no prerelease), so filter, then `sort(compare)` and take the last one. Skip a package when current, wanted and latest are all equal.

</details>

<details><summary>Solution</summary>

```js
'use strict';

// Run from the repo root. These two modules are the examples from this lesson.
const path = require('node:path');
const examples = (file) => require(path.resolve('lessons/04-npm-and-package-json/examples', file));
const { compare } = examples('02-semver-versions.js');
const { maxSatisfying } = examples('03-semver-ranges.js');

const published = {
  express: ['4.18.2', '4.21.2', '5.0.0', '5.1.0', '5.2.0-beta.1'],
  lodash: ['4.17.20', '4.17.21'],
  pg: ['8.11.0', '8.11.5', '8.16.0'],
};
const wantedRanges = { express: '^4.18.0', lodash: '~4.17.0', pg: '^8.11.0' }; // from package.json
const installed = { express: '4.18.2', lodash: '4.17.21', pg: '8.11.0' }; // from the lockfile

function outdated() {
  const rows = [];
  for (const name of Object.keys(installed)) {
    const stable = published[name].filter((v) => !v.includes('-')).sort(compare);
    const latest = stable[stable.length - 1];
    const wanted = maxSatisfying(published[name], wantedRanges[name]);
    if (installed[name] === wanted && wanted === latest) continue; // up to date, npm outdated hides it
    rows.push({ name, current: installed[name], wanted, latest });
  }
  return rows;
}

console.log('Package  Current  Wanted  Latest');
for (const r of outdated()) {
  const major = r.latest.split('.')[0] !== r.wanted.split('.')[0] ? '  (latest is a new major: needs a deliberate upgrade)' : '';
  console.log(`${r.name.padEnd(8)} ${r.current.padEnd(8)} ${r.wanted.padEnd(7)} ${r.latest}${major}`);
}
```

Output:

```text
Package  Current  Wanted  Latest
express  4.18.2   4.21.2  5.1.0  (latest is a new major: needs a deliberate upgrade)
pg       8.11.0   8.16.0  8.16.0
```

`lodash` is hidden because it is fully up to date, and `express` ignores the `5.2.0-beta.1` prerelease when it looks for Latest.

</details>

### Task 3 (harder): find phantom and unused dependencies
Write `checkImports(dir)` that scans the `.js`, `.mjs` and `.cjs` files of a project (skip `node_modules`), extracts the package names from `require('x')`, `import ... from 'x'` and `import('x')`, and compares them with `package.json`. Report packages that are **used but not declared** (phantom) and **declared in `dependencies` but never used**. Ignore relative paths, `node:` imports and built-in modules, reduce `lodash/fp` to `lodash`, and keep scoped names like `@acme/utils` whole. Test it on a small project that your script writes into a temp folder.

<details><summary>Hint</summary>

Use one regular expression with `matchAll`, such as `/(?:require\(\s*|from\s+|import\(\s*|import\s+)['"]([^'"]+)['"]/g`. For the package name: if the request starts with `@`, take the first two segments, otherwise the first. `require('node:module').builtinModules` lists the built-in module names.

</details>

<details><summary>Solution</summary>

```js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinModules } = require('node:module');

// Turn an import string into the package name npm would install.
function packageName(request) {
  if (request.startsWith('.') || request.startsWith('/')) return null; // our own file
  if (request.startsWith('node:')) return null; // built in
  const parts = request.split('/');
  const name = request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return builtinModules.includes(name) ? null : name;
}

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

function checkImports(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  const used = new Set();
  const pattern = /(?:require\(\s*|from\s+|import\(\s*|import\s+)['"]([^'"]+)['"]/g;
  for (const file of sourceFiles(dir)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
      const name = packageName(match[1]);
      if (name) used.add(name);
    }
  }
  return {
    phantom: [...used].filter((name) => !declared.has(name)).sort(),
    unused: Object.keys(pkg.dependencies || {}).filter((name) => !used.has(name)).sort(),
  };
}

// Build a small project in a temp folder and check it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-'));
try {
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'demo',
    dependencies: { express: '^5.0.0', lodash: '^4.17.21', chalk: '^5.0.0' },
    devDependencies: { eslint: '^9.0.0' },
  }));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), `
const express = require('express');
const fs = require('node:fs');
const path = require('path');
const pino = require('pino');            // never declared: a phantom dependency
const { pick } = require('lodash/fp');   // a subpath of a declared package
const utils = require('@acme/utils');    // never declared, scoped
const local = require('./local');
`);
  const result = checkImports(dir);
  console.log('Used but not declared (phantom):', result.phantom.join(', '));
  console.log('Declared but never used        :', result.unused.join(', '));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
```

Output:

```text
Used but not declared (phantom): @acme/utils, pino
Declared but never used        : chalk
```

`eslint` is not reported because it is a dev tool that you call from scripts, not import. A regular expression is a quick approximation: it would also match text inside comments or strings. A production tool such as `depcheck` parses the code properly.

</details>

## Where to go next
- Next lesson: [05. Core Modules Tour: path, os, util, url, readline and More](../05-core-modules-tour/README.md). Built-in modules replace many small packages, and fewer dependencies means less to trust.
- The module system behind `exports` and `type`: [03. Modules: CommonJS and ES Modules](../03-modules/README.md).
- Practise this topic in the interview rounds: [Round 1 screening questions](../../rounds/round-1-screening/questions.md), [Round 2 core questions](../../rounds/round-2-core/questions.md) and, for supply-chain and dependency design, [Round 4 advanced questions](../../rounds/round-4-advanced/questions.md).
- Read more in npm's own docs, which are bundled with npm in `docs/content` and online at docs.npmjs.com: the pages on `package.json`, `package-lock.json`, `scripts` and `config`.
