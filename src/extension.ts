import { exec, execFile, spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { HubDevSite, defaultName, findSiteByPath, hubdevExecutable, nodeEnv, readSites, siteUrl, sitesFile } from './core/hubdev';

interface State {
  executable?: string;
  root?: string;
  site?: HubDevSite;
}

const env = nodeEnv();
let state: State = {};

function readState(): State {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return { executable: hubdevExecutable(env), root, site: findSiteByPath(readSites(env), root) };
}

export function activate(context: vscode.ExtensionContext) {
  const view = new HubDevViewProvider();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'hubdev.focus';

  const refresh = () => {
    state = readState();
    void vscode.commands.executeCommand('setContext', 'hubdev.installed', !!state.executable);
    void vscode.commands.executeCommand('setContext', 'hubdev.linked', !!state.site);
    void vscode.commands.executeCommand('setContext', 'hubdev.active', !!state.site?.active);
    renderStatus(status);
    view.refresh();
  };

  // sites.yml lives outside the workspace (~/.devhub/config), so watch that folder explicitly.
  const sites = sitesFile(env);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(sites)), path.basename(sites)));
  watcher.onDidChange(refresh);
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);

  const site = () => state.site;

  context.subscriptions.push(
    status,
    watcher,
    vscode.window.registerTreeDataProvider('hubdev.view', view),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.commands.registerCommand('hubdev.focus', () => vscode.commands.executeCommand('hubdev.view.focus')),
    vscode.commands.registerCommand('hubdev.refresh', refresh),
    vscode.commands.registerCommand('hubdev.link', async () => {
      if (!state.root) {
        return;
      }
      const name = await vscode.window.showInputBox({
        title: 'HubDev: Site name',
        value: defaultName(path.basename(state.root)),
        validateInput: (v) => (/^[a-z0-9][a-z0-9-]*$/.test(v.trim()) ? undefined : 'Use lowercase letters, numbers and dashes.'),
      });
      if (name) {
        await hubdev('Linking site...', ['site:link', state.root, name.trim()], refresh);
      }
    }),
    vscode.commands.registerCommand('hubdev.unlink', async () => {
      const s = site();
      if (s && (await confirm(`Unlink HubDev site '${s.name}'?`, 'Unlink'))) {
        await hubdev(`Unlinking '${s.name}'...`, ['site:unlink', s.name], refresh);
      }
    }),
    vscode.commands.registerCommand('hubdev.start', () => {
      const s = site();
      return s && hubdev(`Starting '${s.name}'...`, ['site:start', s.name], refresh);
    }),
    vscode.commands.registerCommand('hubdev.stop', () => {
      const s = site();
      return s && hubdev(`Stopping '${s.name}'...`, ['site:stop', s.name], refresh);
    }),
    vscode.commands.registerCommand('hubdev.secure', () => hubdev('Renewing SSL certificates...', ['site:secure'], refresh)),
    vscode.commands.registerCommand('hubdev.openInBrowser', () => {
      const s = site();
      if (s) {
        void vscode.env.openExternal(vscode.Uri.parse(siteUrl(s)));
      }
    }),
    vscode.commands.registerCommand('hubdev.openApp', () => {
      if (state.executable) {
        spawn(state.executable, [], { detached: true, stdio: 'ignore' }).unref();
      }
    }),
  );

  refresh();
  void startupHint();
}

export function deactivate() {}

async function startupHint() {
  if (state.executable && state.root && !state.site) {
    const answer = await vscode.window.showInformationMessage('This project is not linked to HubDev.', 'Link Now');
    if (answer) {
      await vscode.commands.executeCommand('hubdev.link');
    }
  }
}

async function confirm(message: string, action: string): Promise<boolean> {
  return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;
}

function hubdev(title: string, args: string[], refresh: () => void): Thenable<void> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `HubDev: ${title}` }, async () => {
    try {
      void vscode.window.showInformationMessage(`HubDev: ${await run(args)}`);
    } catch (err: any) {
      void vscode.window.showErrorMessage(`HubDev: ${err.message}`);
    }
    refresh();
  });
}

/** Runs the CLI in the workspace root (60s timeout). */
function run(args: string[]): Promise<string> {
  const exe = state.executable;
  if (!exe) {
    return Promise.reject(new Error('HubDev executable not found.'));
  }
  const options = { cwd: state.root, timeout: 60_000, windowsHide: true };

  return new Promise((resolve, reject) => {
    const done = (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        reject(new Error(stderr.trim() || stdout.trim() || error.message));
      } else {
        resolve(stdout.trim() || 'Command completed successfully');
      }
    };

    if (/\.(bat|cmd)$/i.test(exe)) {
      // cmd.exe wrappers need a shell; args are a validated site name or a filesystem path (no `"` on Windows).
      exec([exe, ...args].map((a) => `"${a}"`).join(' '), options, done);
    } else {
      execFile(exe, args, options, done);
    }
  });
}

function renderStatus(status: vscode.StatusBarItem) {
  if (!state.executable || !state.root) {
    status.hide();
    return;
  }
  const s = state.site;
  status.text = s ? `$(link) HubDev${s.active ? '' : ' (stopped)'}` : '$(debug-disconnect) HubDev';
  status.tooltip = s ? siteUrl(s) : 'HubDev: not linked — click to manage';
  status.show();
}

class HubDevViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh() {
    this.changed.fire();
  }

  getTreeItem(node: vscode.TreeItem) {
    return node;
  }

  getChildren(): vscode.TreeItem[] {
    if (!state.executable) {
      return [item('HubDev not found', 'Install HubDev or add it to PATH', 'error')];
    }
    if (!state.root) {
      return [item('No folder open', undefined, 'folder')];
    }
    const s = state.site;
    if (!s) {
      return [item('Not linked', 'Click to link', 'circle-slash', 'hubdev.link')];
    }
    return [
      item(s.active ? 'Linked (active)' : 'Linked (stopped)', undefined, s.active ? 'pass' : 'debug-pause'),
      item('Domain', s.domain, 'globe', 'hubdev.openInBrowser'),
      item('PHP', s.phpVersion, 'versions'),
      item('Database', s.database || '—', 'database'),
      item('Mode', s.mode, 'server-process'),
    ];
  }
}

function item(label: string, description: string | undefined, icon: string, command?: string): vscode.TreeItem {
  const node = new vscode.TreeItem(label);
  node.description = description;
  node.iconPath = new vscode.ThemeIcon(icon);
  if (command) {
    node.command = { command, title: label };
  }
  return node;
}
