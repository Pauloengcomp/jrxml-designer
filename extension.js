const vscode = require('vscode');
const crypto = require('crypto');

const VIEW = 'jrxmlDesigner.editor';
const LAYOUT = 'layout';
let clipboard = []; // compartilhado entre os relatórios abertos

function activeUri() {
  return vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
}

function html(webview, root, layout) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const media = (name) => webview.asWebviewUri(vscode.Uri.joinPath(root, 'media', name));
  const scripts = ['model.js', 'schema.js', 'canvas.js', 'panels.js', 'layout.js', 'main.js'];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'">
<link rel="stylesheet" href="${media('style.css')}"></head><body data-layout="${encodeURIComponent(JSON.stringify(layout))}">
${scripts.map((s) => `<script nonce="${nonce}" src="${media(s)}"></script>`).join('\n')}
</body></html>`;
}

function resolveEditor(context, document, panel) {
  const { webview } = panel;
  webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };

  let seq = 0;
  let applying = false;
  let queue = Promise.resolve();
  const send = (force = false) => webview.postMessage({ type: 'document', text: document.getText(), seq, force });

  async function edit({ before, start, end, insert, seq: next }) {
    seq = next;
    // se o XML mudou por fora, não grava por cima
    if (document.getText() !== before) return send(true);
    const change = new vscode.WorkspaceEdit();
    change.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), insert);
    applying = true;
    try {
      if (!(await vscode.workspace.applyEdit(change))) vscode.window.showErrorMessage('Não foi possível alterar o relatório.');
    } finally {
      applying = false;
      send();
    }
  }

  async function handle(message) {
    switch (message.type) {
      case 'ready':
        await webview.postMessage({ type: 'clipboard', items: clipboard });
        return send(true);
      case 'edit': return edit(message);
      case 'layout': return context.globalState.update(LAYOUT, message.value);
      case 'copy': clipboard = message.items; return;
      case 'save': return document.save();
      case 'undo': return vscode.commands.executeCommand('undo');
      case 'redo': return vscode.commands.executeCommand('redo');
      case 'xml': {
        const at = document.positionAt(message.offset || 0);
        return vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(at, at) });
      }
    }
  }

  const listeners = [
    webview.onDidReceiveMessage((message) => {
      queue = queue.then(() => handle(message)).catch((e) => vscode.window.showErrorMessage(`Designer JRXML: ${e.message}`));
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!applying && e.contentChanges.length && e.document.uri.toString() === document.uri.toString()) send();
    }),
    panel.onDidChangeViewState(() => panel.active && webview.postMessage({ type: 'clipboard', items: clipboard }))
  ];
  panel.onDidDispose(() => listeners.forEach((d) => d.dispose()));
  webview.html = html(webview, context.extensionUri, context.globalState.get(LAYOUT, {}));
}

exports.activate = (context) => {
  const command = (id, run) => vscode.commands.registerCommand(id, async (uri) => {
    const target = uri || activeUri();
    if (target) await run(target);
  });
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW,
      { resolveCustomTextEditor: (document, panel) => resolveEditor(context, document, panel) },
      { webviewOptions: { retainContextWhenHidden: true } }),
    command('jrxmlDesigner.open', (uri) => vscode.commands.executeCommand('vscode.openWith', uri, VIEW)),
    command('jrxmlDesigner.xml', (uri) => vscode.commands.executeCommand('vscode.openWith', uri, 'default'))
  );
};
