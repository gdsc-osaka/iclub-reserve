import { describe, expect, it, vi } from "vite-plus/test";

import {
  setAuthTraceAttributes,
  setQueueTraceAttributes,
  setScheduledTraceAttributes,
  type SpanLike,
} from "./trace-context";

describe("setAuthTraceAttributes", () => {
  it("ログイン情報があるとき、user.id と session.id がスパン属性に設定される", () => {
    const span: SpanLike = {
      setAttribute: vi.fn(),
    };

    setAuthTraceAttributes(span, {
      user: { id: "user-123" },
      session: { id: "session-456" },
    });

    expect(span.setAttribute).toHaveBeenCalledTimes(2);
    expect(span.setAttribute).toHaveBeenCalledWith("user.id", "user-123");
    expect(span.setAttribute).toHaveBeenCalledWith("session.id", "session-456");
  });

  it("auth が null のとき、スパン属性は設定されない", () => {
    const span: SpanLike = {
      setAttribute: vi.fn(),
    };

    setAuthTraceAttributes(span, null);

    expect(span.setAttribute).not.toHaveBeenCalled();
  });

  it("span が undefined のとき、例外を投げずに正常終了する", () => {
    expect(() => {
      setAuthTraceAttributes(undefined, {
        user: { id: "user-123" },
        session: { id: "session-456" },
      });
    }).not.toThrow();
  });
});

describe("setScheduledTraceAttributes", () => {
  it("cron 式がスパン属性 cron.schedule に設定される", () => {
    const span: SpanLike = {
      setAttribute: vi.fn(),
    };

    setScheduledTraceAttributes(span, "* * * * *");

    expect(span.setAttribute).toHaveBeenCalledTimes(1);
    expect(span.setAttribute).toHaveBeenCalledWith("cron.schedule", "* * * * *");
  });

  it("span が undefined のとき、例外を投げずに正常終了する", () => {
    expect(() => {
      setScheduledTraceAttributes(undefined, "* * * * *");
    }).not.toThrow();
  });
});

describe("setQueueTraceAttributes", () => {
  it("キュー名とバッチサイズがスパン属性 queue.name と queue.batch_size に設定される", () => {
    const span: SpanLike = {
      setAttribute: vi.fn(),
    };

    setQueueTraceAttributes(span, {
      name: "mail-queue",
      batchSize: 5,
    });

    expect(span.setAttribute).toHaveBeenCalledTimes(2);
    expect(span.setAttribute).toHaveBeenCalledWith("queue.name", "mail-queue");
    expect(span.setAttribute).toHaveBeenCalledWith("queue.batch_size", 5);
  });

  it("span が undefined のとき、例外を投げずに正常終了する", () => {
    expect(() => {
      setQueueTraceAttributes(undefined, {
        name: "mail-queue",
        batchSize: 5,
      });
    }).not.toThrow();
  });
});
