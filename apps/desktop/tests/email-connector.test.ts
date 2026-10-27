import { describe, expect, it } from "vitest";
import { HimalayaEmailConnector } from "../src/core/email-connector";

describe("HimalayaEmailConnector", () => {
  it("识别 qq 账号的 IMAP/SMTP 后端", async () => {
    const connector = new HimalayaEmailConnector({
      account: "qq",
      runCommand: async () =>
        JSON.stringify({
          accounts: [
            { name: "qq", backends: ["imap", "smtp"] },
          ],
        }),
    });

    await expect(connector.checkAccount()).resolves.toBe(true);
  });

  it("解析 Himalaya 邮件头且不读取正文", async () => {
    const connector = new HimalayaEmailConnector({
      account: "qq",
      inbox: "Inbox",
      runCommand: async (args) => {
        expect(args).toContain("-a");
        expect(args).toContain("qq");
        return JSON.stringify([
          {
            id: "42",
            subject: "测试主题",
            from: [{ name: "发件人" }],
            to: [{ name: "收件人" }],
            date: "2026-10-27T12:00:00Z",
            flags: ["seen"],
            "has-attachment": false,
          },
        ]);
      },
    });

    await expect(connector.listRecent(5)).resolves.toEqual([
      {
        id: "42",
        subject: "测试主题",
        from: ["发件人"],
        to: ["收件人"],
        date: "2026-10-27T12:00:00Z",
        flags: ["seen"],
        hasAttachment: false,
      },
    ]);
  });

  it("发信和删除通过 Himalaya 参数数组执行", async () => {
    const calls: string[][] = [];
    const connector = new HimalayaEmailConnector({
      account: "qq",
      runCommand: async (args) => {
        calls.push(args);
        return "";
      },
    });

    await connector.sendMessage({
      to: "recipient@example.com",
      subject: "测试",
      body: "正文",
    });
    await connector.moveToDeleted("42");

    expect(calls[0]).toEqual(
      expect.arrayContaining(["message", "compose", "--send"]),
    );
    expect(calls[1]).toEqual(
      expect.arrayContaining(["message", "delete", "42"]),
    );
  });
});
