# Contributing to genesis-set

Thank you for helping improve genesis-set.

This repository is **built**: its content is generated from the source repository of the
Genesis tooling and replaced on every release. A pull request here is still the right way
to report a mistake or propose a change. A maintainer carries an accepted change into the
source, and the next release brings it back here.

- **A wrong or unclear instruction in a skill or a Genesis additions file?** Open an issue
  with the file, the sentence and what an agent did because of it, or a pull request with
  the fix.
- **A generated service behaves differently from what genesis-set says?** Open an issue
  with the blueprint fragment, the request and the answer you got.
- **Something about designing or writing the blueprint itself** belongs to
  [mind-set](https://github.com/Mindbricks/mind-set); a change to the OpenAPPL language
  belongs to the OpenAPPL repository and its RFC process.

Before a pull request, run the tests:

```bash
npm test
```

## AI and automated contributions

Everything sent to this repository is reviewed by people. For every pull request and issue:

- **A person is responsible.** You may use AI tools to help, but you write the
  contribution, you understand every line of it, and you can explain and defend it in
  review.
- **Say so.** If an AI tool helped produce the content, state it in the description in one
  line: which tool, and for what. Spelling and grammar help needs no mention.
- **No autonomous submissions.** Pull requests and issues opened by an agent or a bot on its
  own, without a person who wrote and stands behind them, are not accepted.
- **Low-effort submissions are closed** without a detailed review.

Using genesis-set with an agent to compile your own blueprints is what it is for, and is
welcome.

## Sign your commits

Every commit needs a Developer Certificate of Origin sign-off
(https://developercertificate.org). Add it with `git commit -s`.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
