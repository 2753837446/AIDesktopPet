import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";

const API_KEY_PATTERN = /^sk-[A-Za-z0-9]{20,}$/;
type CredentialName = "deepseek" | "siliconflow";

export class CredentialStore {
  constructor(private readonly userDataPath: string) {}

  get credentialPath(): string {
    return this.pathFor("deepseek");
  }

  async isConfigured(): Promise<boolean> {
    return this.isProviderConfigured("deepseek");
  }

  async isProviderConfigured(provider: CredentialName): Promise<boolean> {
    try {
      const value = await readFile(this.pathFor(provider));
      return value.length > 0;
    } catch {
      return false;
    }
  }

  async setDeepSeekKey(apiKey: string): Promise<void> {
    return this.setProviderKey("deepseek", apiKey);
  }

  async setProviderKey(
    provider: CredentialName,
    apiKey: string,
  ): Promise<void> {
    const normalized = apiKey.trim();
    if (!API_KEY_PATTERN.test(normalized)) {
      throw new Error("INVALID_DEEPSEEK_KEY");
    }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("SECURE_STORAGE_UNAVAILABLE");
    }

    const credentialPath = this.pathFor(provider);
    await mkdir(path.dirname(credentialPath), { recursive: true });
    const encrypted = await safeStorage.encryptStringAsync(normalized);
    const temporaryPath = `${credentialPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporaryPath, encrypted, { mode: 0o600 });
      await rename(temporaryPath, credentialPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async getDeepSeekKey(): Promise<string> {
    return this.getProviderKey("deepseek");
  }

  async getProviderKey(provider: CredentialName): Promise<string> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("SECURE_STORAGE_UNAVAILABLE");
    }
    const encrypted = await readFile(this.pathFor(provider));
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    if (decrypted.shouldReEncrypt) {
      await this.setDeepSeekKey(decrypted.result);
    }
    return decrypted.result;
  }

  async clearDeepSeekKey(): Promise<void> {
    return this.clearProviderKey("deepseek");
  }

  async clearProviderKey(provider: CredentialName): Promise<void> {
    await unlink(this.pathFor(provider)).catch((error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    });
  }

  private pathFor(provider: CredentialName): string {
    return path.join(this.userDataPath, "credentials", `${provider}.bin`);
  }
}
