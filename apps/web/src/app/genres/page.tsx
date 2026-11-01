import { redirect } from "next/navigation";

/** Genres live in Search now; keep old links working. */
export default function GenresPage() {
  redirect("/search");
}
