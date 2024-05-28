# Mockium
Mockium (a play on the words *Mock* and *Chromium*) is a lightweight, V8-based sandbox for the dynamic execution of
untrusted JavaScript code.
It aims to improve traditional static analysis by detecting API calls coming from `eval`, `new Function` and heavily
obfuscated code, and does so with a tiny footprint in terms of both memory and CPU usage.

While originally designed to elicit the behavior of browser extensions *at scale* without having to launch an
instrumented Chromium browser instance and wait about 10 minutes between runs, it can also run any modern JavaScript
code in mere **seconds**.

## Features
Mockium works by mocking all objects accessed by the executed code at runtime, while logging get, set and call events.
It automatically runs all callback functions found inside the sandbox to increase execution coverage.

It has built-in support for:
- 📦 [JavaScript modules](https://developer.mozilla.org/docs/Web/JavaScript/Guide/Modules)
- 🔗 [Custom origins](https://developer.mozilla.org/docs/Glossary/Origin)
- 🎨 Object tainting
- ⏰ Execution limits (max memory usage and timeout)
- 🎣 Custom hooks
- 🧾 Logging
- 🕵 Event tracing (code that triggered it)
- 🔎 Report events querying

## Getting Started

### Requirements
- Node.js 20 (LTS)

### Examples
The easiest way to run code with Mockium is to create an instance and call the `Mockium.run()` method:

```js
const mockium = new Mockium();
await mockium.run('example.js', 'alert("Hi there!")');
console.log(mockium.getReport().getAll());
/*
[
    {
        type: 'GetEvent',
        path: 'alert',
        value: { ref: 1 },
        location: { filename: 'file:///example.js', line: 1, column: 1 }
    },
    {
        type: 'CallEvent',
        path: 'alert',
        arguments: [ { literal: 'Hi there!' } ],
        returns: { ref: 2 },
        isConstructor: false,
        location: { filename: 'file:///example.js', line: 1, column: 1 }
    }
]
*/
```

You can also run apps that span several modules by providing a resolver:
```js
const mockium = new Mockium({ origin: 'https://localhost' });
mockium.setResolver(async url => {
    if (url.href === 'https://localhost/index.js') {
        return 'import { test } from "./test.js";\n' +
               'console.log("Test is " + test());\n';
    }
    if (url.pathname === '/test.js') {
        return 'export const test = () => 123';
    }
    return null;
});
await mockium.run('index.js');
console.log(mockium.getReport().find({ type: 'CallEvent', path: 'console.log' }));
/*
{
    type: 'CallEvent',
    path: 'console.log',
    arguments: [ { literal: 'Test is 123' } ],
    returns: { literal: undefined },
    isConstructor: false,
    location: { filename: 'https://localhost/index.js', line: 2, column: 9 }
}
*/
```
