import { requireUser } from "@/lib/auth";
import { monthKeyOf } from "@/lib/listening";
import { MonthView } from "./MonthView";

export default async function MonthPage() {
  const user = await requireUser();
  return <MonthView viewer={user} month={monthKeyOf()} />;
}
