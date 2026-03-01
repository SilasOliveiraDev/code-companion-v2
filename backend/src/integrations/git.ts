import { simpleGit, SimpleGit, DefaultLogFields, ListLogLine } from 'simple-git';
import { GitStatus, GitCommit } from '../types';

export class GitService {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  async isRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<GitStatus> {
    const status = await this.git.status();
    const branchSummary = await this.git.branch();

    return {
      branch: status.current || 'HEAD',
      staged: status.staged,
      unstaged: [...status.modified, ...status.deleted],
      untracked: status.not_added,
      ahead: status.ahead,
      behind: status.behind,
    };
  }

  async getLog(limit = 20): Promise<GitCommit[]> {
    const log = await this.git.log({ maxCount: limit });
    return (log.all as ReadonlyArray<DefaultLogFields & ListLogLine>).map((entry) => ({
      hash: entry.hash.substring(0, 7),
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
    }));
  }

  async getBranches(): Promise<{ current: string; all: string[] }> {
    const branches = await this.git.branch();
    return {
      current: branches.current,
      all: Object.keys(branches.branches),
    };
  }

  async createBranch(name: string, checkout = true): Promise<void> {
    if (checkout) {
      await this.git.checkoutLocalBranch(name);
    } else {
      await this.git.branch([name]);
    }
  }

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }

  async stageFiles(files: string[]): Promise<void> {
    await this.git.add(files);
  }

  async stageAll(): Promise<void> {
    await this.git.add('.');
  }

  async commit(message: string, author?: string): Promise<string> {
    const options: Record<string, string> = {};
    if (author) options['--author'] = author;
    const result = await this.git.commit(message, undefined, options);
    return result.commit;
  }

  async getDiff(file?: string): Promise<string> {
    if (file) {
      return this.git.diff([file]);
    }
    return this.git.diff();
  }

  async getStagedDiff(): Promise<string> {
    return this.git.diff(['--cached']);
  }

  async pull(remote = 'origin', branch?: string): Promise<void> {
    if (branch) {
      await this.git.pull(remote, branch);
    } else {
      await this.git.pull();
    }
  }

  async setConfig(name: string, email: string): Promise<void> {
    if (name) await this.git.addConfig('user.name', name);
    if (email) await this.git.addConfig('user.email', email);
  }

  async getConfig(): Promise<{name: string, email: string}> {
    const list = await this.git.listConfig();
    // listConfig returns arrays of values for properties
    const nameData = list.all['user.name'];
    const emailData = list.all['user.email'];
    return {
      name: Array.isArray(nameData) ? nameData[0] : (typeof nameData === 'string' ? nameData : ''),
      email: Array.isArray(emailData) ? emailData[0] : (typeof emailData === 'string' ? emailData : '')
    };
  }

  async push(remote = 'origin', branch?: string): Promise<void> {
    if (branch) {
      await this.git.push(remote, branch);
    } else {
      await this.git.push();
    }
  }

  async getRemotes(): Promise<string[]> {
    const remotes = await this.git.getRemotes(true);
    return remotes.map((r) => r.name);
  }

  async init(): Promise<void> {
    await this.git.init();
  }

  getRepoPath(): string {
    return this.repoPath;
  }
}
