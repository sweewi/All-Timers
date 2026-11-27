import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { monthKeyOf } from "@/lib/listening";
import { MonthView } from "../MonthView";

export default async function PastMonthPage({ params }: PageProps<"/month/[key]">) {
  const user = await requireUser();
  const { key } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) notFound();
  if (key === monthKeyOf()) redirect("/month");
  return <MonthView viewer={user} month={key} />;
}
