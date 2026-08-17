import { redirect } from "react-router";

export const loader = async ({request}) => {
  const url = new URL(request.url);
   return redirect(`/app/onboarding?${url.searchParams.toString()}`);
}