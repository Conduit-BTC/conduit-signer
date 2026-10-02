import { describe, expect, test } from "bun:test"
import ts from "typescript"

const staticCredentialRules = [
  {
    rule: "encoded secret key",
    pattern: /\bnsec1[0-9a-z]+\b/gi,
  },
  {
    rule: "fixed private scalar",
    pattern:
      /\b(?:const|let|var)\s+(?:[A-Z0-9_]*(?:PRIVATE|SECRET)[A-Z0-9_]*|key|keyBytes|sk)\s*=\s*(?:new\s+Uint8Array\s*\(\s*32\s*\)\.fill\s*\(|Uint8Array\.from\s*\(\s*\{\s*length\s*:\s*32\s*\}\s*,|["'`][0-9a-f]+["'`]\.repeat\s*\(|["'`][0-9a-f]{64}["'`])/gi,
  },
  {
    rule: "fixed credential variable",
    pattern:
      /\b(?:const|let|var)\s+[A-Z0-9_]*(?:PRIVATE_KEY|SECRET_KEY|CLIENT_SECRET|PAIRING_SECRET|PASSWORD|PASSPHRASE|MNEMONIC|RECOVERY_PHRASE)[A-Z0-9_]*\s*=\s*["'`][^"'`]+["'`]/gi,
  },
  {
    rule: "fixed account-key identifier",
    pattern:
      /["'`]?\b(?:[A-Za-z0-9_$]*(?:nsec(?:hex|value|bytes)?|(?:account|signing|signer|merchant|buyer)(?:private|secret)?key(?:hex|value|bytes)?|client(?:private|secret)?key(?:hex|value|bytes)?)|[A-Za-z0-9_$]*(?:nsec(?:_(?:hex|value|bytes))?|(?:account|signing|signer|merchant|buyer)(?:_(?:private|secret))?_key(?:_(?:hex|value|bytes))?|client_(?:(?:private|secret)_)?key(?:_(?:hex|value|bytes))?))\b["'`]?\s*(?:=|:)\s*(?:["'`][^"'`\r\n]+["'`]|(?:new\s+Uint8Array|Uint8Array\.from)\s*\()/gi,
  },
  {
    rule: "fixed credential property",
    pattern:
      /\b(?:credential|privateKey|secretKey|clientPrivateKey|clientSecret|pairingSecret|recoveryPhrase|mnemonic|passphrase|password|salt|iv|ciphertext)\s*:\s*["'`][^"'`]+["'`]/gi,
  },
  {
    rule: "fixed credential input",
    pattern:
      /\b(?:password|passphrase|recovery|mnemonic|privateKey|secret)[A-Za-z0-9_]*\.fill\s*\(\s*["'`][^"'`]+["'`]\s*\)/gi,
  },
  {
    rule: "fixed vault value",
    pattern:
      /\bvault\.store\s*\(\s*[^,]+,\s*(?:["'`][0-9a-f]{2}["'`]\.repeat\s*\(\s*32\s*\)|["'`][0-9a-f]{64}["'`])/gi,
  },
  {
    rule: "credential-bearing signer URI",
    pattern:
      /\b(?:bunker|nostrconnect|nostr\+walletconnect):\/\/[^\s"'`]*\bsecret=[^\s&"'`]+/gi,
  },
  {
    rule: "credential-bearing URL userinfo",
    pattern: /\b(?:https?|wss?):\/\/[^/\s"'`:@]+:[^/@\s"'`]+@/gi,
  },
] as const

type Finding = { file: string; line: number; rule: string }
function findStatic(file: string, source: string): Finding[] {
  return staticCredentialRules.flatMap(({ rule, pattern }) =>
    Array.from(source.matchAll(pattern), (match) => ({
      file,
      line: source.slice(0, match.index).split("\n").length,
      rule,
    })),
  )
}

// A path alone never grants an encoding exception. Check its source and sink.
function encodingAllowed(file: string, source: string): boolean {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const imports = new Map<string, string>()
  for (const node of tree.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      continue
    const bindings = node.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const spec of bindings.elements) {
        if (
          spec.propertyName &&
          ["nsecEncode", "generateSecretKey"].includes(spec.propertyName.text)
        )
          return false
        imports.set(spec.name.text, node.moduleSpecifier.text)
      }
    }
  }
  let valid = true
  const checkShadowing = (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      ["nsecEncode", "generateSecretKey"].includes(node.name.getText(tree))
    )
      valid = false
    ts.forEachChild(node, checkShadowing)
  }
  checkShadowing(tree)
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree).endsWith("nsecEncode")
    ) {
      if (
        node.expression.getText(tree) !== "nsecEncode" ||
        imports.get("nsecEncode") !== "nostr-tools/nip19" ||
        imports.get("generateSecretKey") !== "nostr-tools/pure" ||
        node.arguments.length !== 1 ||
        node.arguments[0]?.getText(tree) !== "secret"
      ) {
        valid = false
      } else {
        let owner: ts.Node | undefined = node.parent
        while (
          owner &&
          !ts.isArrowFunction(owner) &&
          !ts.isFunctionDeclaration(owner)
        )
          owner = owner.parent
        const body =
          owner &&
          (ts.isArrowFunction(owner) || ts.isFunctionDeclaration(owner))
            ? owner.body
            : undefined
        const declaration =
          body && ts.isBlock(body)
            ? body.statements.find(
                (s) =>
                  ts.isVariableStatement(s) &&
                  s.declarationList.flags & ts.NodeFlags.Const &&
                  s.declarationList.declarations.length === 1 &&
                  s.declarationList.declarations[0]?.name.getText(tree) ===
                    "secret" &&
                  s.declarationList.declarations[0]?.initializer?.getText(
                    tree,
                  ) === "generateSecretKey()",
              )
            : undefined
        // The approved fixture never reads an environment value or transforms
        // a fixed scalar. Before encoding, the key has no other use or write.
        if (!body || !declaration || declaration.end >= node.pos) valid = false
        else {
          let keyReferences = 0
          const before = (n: ts.Node) => {
            if (n.end <= node.pos && ts.isIdentifier(n) && n.text === "secret")
              keyReferences++
            ts.forEachChild(n, before)
          }
          ts.forEachChild(body, before)
          if (keyReferences !== 1) valid = false
        }
        if (file === "proof/signer.ts") {
          const sink = node.parent
          if (
            !ts.isBinaryExpression(sink) ||
            sink.left.getText(tree) !== "input.value" ||
            sink.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
            sink.right !== node ||
            !owner ||
            !ts.isArrowFunction(owner) ||
            !body?.getText(tree).includes("finally") ||
            !body?.getText(tree).includes("secret.fill(0)")
          )
            valid = false
        } else if (file === "tests/vault.test.ts") {
          if (
            !owner ||
            !ts.isFunctionDeclaration(owner) ||
            owner.name?.text !== "setup" ||
            !ts.isVariableDeclaration(node.parent) ||
            node.parent.name.getText(tree) !== "encoded"
          )
            valid = false
        } else valid = false
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return valid
}

describe("disposable fixture policy", () => {
  test("encoding exception requires a runtime source, bounded path and signer input sink", () => {
    const make = (
      source = "generateSecretKey()",
      sink = "input.value",
      keyUse = "",
    ) =>
      [
        'import { generateSecretKey } from "nostr-tools/pure"',
        'import { nsecEncode } from "nostr-tools/nip19"',
        "button.onclick = () => {",
        "const secret = " + source,
        keyUse,
        "try { " + sink + " = " + ["nsec", "Encode"].join("") + "(secret) }",
        "finally { secret.fill(0) }",
        "}",
      ].join("\n")
    expect(encodingAllowed("proof/signer.ts", make())).toBe(true)
    for (const bad of [
      make("readKey()"),
      make("process.env.KEY"),
      make(undefined, "result.key"),
      make(undefined, undefined, "secret[0] = 1"),
      make(undefined, undefined, "send(secret)"),
      make(undefined, undefined, "const generateSecretKey = readKey"),
    ]) {
      expect(encodingAllowed("proof/signer.ts", bad)).toBe(false)
    }
    expect(encodingAllowed("proof/host.ts", make())).toBe(false)
    expect(encodingAllowed("tests/other.test.ts", make())).toBe(false)
    expect(
      encodingAllowed(
        "proof/signer.ts",
        make().replace('from "nostr-tools/pure"', 'from "unapproved"'),
      ),
    ).toBe(false)
  })
  test("fixed-key and credential-sink rules remain non-vacuous", () => {
    for (const marker of [
      ["nsec", "1", "syntheticmarker"].join(""),
      ["const key = new ", "Uint8Array(32)", ".fill("].join(""),
      ["const ", "SIGNER_PRIVATE_KEY", ' = "prohibited marker"'].join(""),
      ["password", ': "prohibited marker"'].join(""),
      ["https://user", ":prohibited@", "invalid.example"].join(""),
    ])
      expect(findStatic("synthetic.ts", marker).length > 0).toBe(true)
    expect(
      findStatic("synthetic.ts", "const key = generateSecretKey()"),
    ).toEqual([])
  })
  test("tracked proof and test source obey the exception without fixed credentials", async () => {
    let count = 0
    const findings: Finding[] = []
    for (const area of ["proof", "tests"]) {
      for await (const file of new Bun.Glob(`${area}/**/*.ts`).scan({
        onlyFiles: true,
      })) {
        count++
        const source = await Bun.file(file).text()
        findings.push(...findStatic(file, source))
        expect(encodingAllowed(file, source)).toBe(true)
      }
    }
    expect(count > 0).toBe(true)
    expect(findings).toEqual([])
  })
})
