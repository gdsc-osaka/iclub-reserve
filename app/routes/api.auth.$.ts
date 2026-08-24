import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getAuth } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return getAuth().handler(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return getAuth().handler(request);
}
