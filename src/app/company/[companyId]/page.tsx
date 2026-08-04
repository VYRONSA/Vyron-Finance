import { redirect } from "next/navigation";

export default async function CompanyRootPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/company/${companyId}/dashboard`);
}
