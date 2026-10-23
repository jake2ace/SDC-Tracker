import type { Forecast } from "../contracts/domain.ts";
import { calculateForecast } from "./forecast.ts";
import { assertDate, invalid, today, type Context } from "./operations.ts";

/** A forecast is a read-only projection of one consistent company snapshot. */
export function getForecast(ctx: Context, query: URLSearchParams): Forecast {
  const keys: string[] = [];
  query.forEach((_value, key) => keys.push(key));
  if (keys.length !== 2 || query.getAll("asOfDate").length !== 1 || query.getAll("delayDays").length !== 1) {
    invalid("query", "Provide exactly one asOfDate and delayDays.");
  }
  const asOfDate = query.get("asOfDate")!;
  const delayText = query.get("delayDays")!;
  assertDate(asOfDate, "asOfDate");
  if (asOfDate !== today(ctx)) invalid("asOfDate", "Forecast date must equal the current MYT demo date.");
  if (!/^(?:0|[1-9]\d?)$/.test(delayText) || Number(delayText) > 30) invalid("delayDays", "Delay must be an integer from 0 to 30.");
  return ctx.store.transaction(() => {
    const workspace = ctx.store.getWorkspace(ctx.actor);
    if (workspace.forecastDefaults.asOfDate !== asOfDate) invalid("asOfDate", "Opening balance is not configured for this date.");
    return calculateForecast({ ...workspace.forecastDefaults, asOfDate, delayDays: Number(delayText),
      companyId: ctx.actor.companyId, asOf: ctx.now, invoices: workspace.invoices,
      promises: workspace.promises, payments: workspace.payments, expenses: workspace.expenses });
  });
}
