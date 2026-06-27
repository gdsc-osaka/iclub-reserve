import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export default function GroupReservation() {
  const inputClass = "border border-black";
  return (
    <form action="/group_reservation/create" method="post">
      <Label htmlFor="group_id">団体ID</Label>
      <br />
      <Input type="text" id="group_id" name="group_id" required className={inputClass} />
      <br />

      <Label htmlFor="facility_id">施設ID</Label>
      <br />
      <Input type="text" id="facility_id" name="facility_id" required className={inputClass} />
      <br />

      <Label htmlFor="start_at">開始日時</Label>
      <br />
      <Input type="datetime-local" id="start_at" name="start_at" required className={inputClass} />
      <br />

      <Label htmlFor="end_at">終了日時</Label>
      <br />
      <Input type="datetime-local" id="end_at" name="end_at" required className={inputClass} />
      <br />

      <Label htmlFor="headcount">人数</Label>
      <br />
      <Input
        type="number"
        id="headcount"
        name="headcount"
        required
        min={1}
        className={inputClass}
      />
      <br />

      <Label htmlFor="note">備考</Label>
      <br />
      <Textarea id="note" name="note" required className={inputClass} />
      <br />

      <Label htmlFor="status">予約状態</Label>
      <br />
      <Select name="status" defaultValue="provisional">
        <SelectTrigger className={inputClass}>
          <SelectValue placeholder="予約状態" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="provisional">仮予約</SelectItem>
          <SelectItem value="approved">確定</SelectItem>
          <SelectItem value="withdrawn">承認前キャンセル</SelectItem>
          <SelectItem value="rejected">却下</SelectItem>
          <SelectItem value="cancelled">承認後キャンセル</SelectItem>
          <SelectItem value="cancelled_by_staff">承認後に事務局がキャンセル</SelectItem>
        </SelectContent>
      </Select>
      <br />

      <Button type="submit" className={inputClass}>
        送信
      </Button>
    </form>
  );
}
