export type TossConfirmResult =
  | { ok: true; payment: TossPayment }
  | { ok: false; code: string; message: string };

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  approvedAt: string;
  method?: string;
  status: string;
};

const TOSS_BASE = "https://api.tosspayments.com";

export async function confirmTossPayment(input: {
  secretKey: string;
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossConfirmResult> {
  const auth = btoa(`${input.secretKey}:`);
  let resp: Response;
  try {
    resp = await fetch(`${TOSS_BASE}/v1/payments/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey: input.paymentKey,
        orderId: input.orderId,
        amount: input.amount,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message: error instanceof Error ? error.message : "network failure",
    };
  }
  const body = (await resp.json().catch(() => null)) as
    | (TossPayment & { code?: string; message?: string })
    | null;
  if (!resp.ok || !body || !body.paymentKey) {
    return {
      ok: false,
      code: body?.code ?? `http_${resp.status}`,
      message: body?.message ?? "결제 승인에 실패했습니다.",
    };
  }
  return {
    ok: true,
    payment: {
      paymentKey: body.paymentKey,
      orderId: body.orderId,
      totalAmount: body.totalAmount,
      approvedAt: body.approvedAt,
      method: body.method,
      status: body.status,
    },
  };
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() < day) next.setUTCDate(0);
  return next;
}
