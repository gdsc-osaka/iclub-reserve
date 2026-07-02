import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";

export default function GroupReservation() {
  const inputClass = "border border-black";
  return (
    <form action="/group_reservation/create" method="post">
      <Label htmlFor="id">ID</Label>
      <br />
      <Input type="text" id="id" name="id" required className={inputClass} />
      <br />

      <Label htmlFor="name">施設名</Label>
      <br />
      <Input type="text" id="name" name="facility_name" required className={inputClass} />
      <br />

      <Label htmlFor="description">施設の説明</Label>
      <br />
      <Input type="text" id="description" name="description" required className={inputClass} />
      <br />

      <Button type="submit" className={inputClass}>
        送信
      </Button>
    </form>
  );
}
