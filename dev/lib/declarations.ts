import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

/** Emits one checked declaration graph with module-format-specific paths and extensions. */
export async function declarations(root: string): Promise<void> {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.build.json'), ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
  }

  const writes: Promise<void>[] = [];
  for (const format of ['esm', 'cjs'] as const) {
    const extension = format === 'esm' ? '.js' : '.cjs';
    const result = program.emit(
      undefined,
      (filename, text) => {
        const target = path
          .join(root, 'dist', format, path.relative(path.join(root, 'dist/esm'), filename))
          .replace(/\.d\.ts$/, format === 'esm' ? '.d.ts' : '.d.cts');
        writes.push(
          (async () => {
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, text);
          })(),
        );
      },
      undefined,
      true,
      {
        afterDeclarations: [
          (context) => {
            const specifier = (node: ts.Expression): ts.Expression =>
              ts.isStringLiteral(node) && /^\.\.?\//.test(node.text) && node.text.endsWith('.ts')
                ? context.factory.createStringLiteral(node.text.slice(0, -3) + extension)
                : node;
            const visit: ts.Visitor = (node) => {
              if (ts.isImportDeclaration(node)) {
                return context.factory.updateImportDeclaration(
                  node,
                  node.modifiers,
                  node.importClause,
                  specifier(node.moduleSpecifier),
                  node.attributes,
                );
              }
              if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
                return context.factory.updateExportDeclaration(
                  node,
                  node.modifiers,
                  node.isTypeOnly,
                  node.exportClause,
                  specifier(node.moduleSpecifier),
                  node.attributes,
                );
              }
              if (
                ts.isImportTypeNode(node) &&
                ts.isLiteralTypeNode(node.argument) &&
                ts.isStringLiteral(node.argument.literal)
              ) {
                return context.factory.updateImportTypeNode(
                  node,
                  context.factory.createLiteralTypeNode(
                    specifier(node.argument.literal) as ts.StringLiteral,
                  ),
                  node.attributes,
                  node.qualifier,
                  node.typeArguments,
                  node.isTypeOf,
                );
              }
              return ts.visitEachChild(node, visit, context);
            };
            return (node) => ts.visitNode(node, visit) as ts.SourceFile | ts.Bundle;
          },
        ],
      },
    );
    // JSON imports have no declaration output, so TypeScript reports a skipped emit even while
    // writing the complete TypeScript declaration graph.
    if (result.diagnostics.length) {
      throw new Error(
        `${format} declaration emission failed\n` +
          ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
            getCanonicalFileName: (file) => file,
            getCurrentDirectory: () => root,
            getNewLine: () => '\n',
          }),
      );
    }
  }
  await Promise.all(writes);
}
