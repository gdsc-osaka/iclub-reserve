export default function GroupReservation() {
    return (<form action="/group_reservation/create" method="post">
        <label htmlFor="group_id">団体ID</label><br />
        <input type="text" id="group_id" name="group_id" required
        style={{border: "1px solid black"}} />
        <br />

        <label htmlFor="facility_id">施設ID</label><br />
        <input type="text" id="facility_id" name="facility_id" required
        style={{border: "1px solid black"}} />
        <br />

        <label htmlFor="start_at">開始日時</label><br />
        <input type="datetime-local" id="start_at" name="start_at" required
        style={{border: "1px solid black"}} />
        <br />

        <label htmlFor="end_at">終了日時</label><br />
        <input type="datetime-local" id="end_at" name="end_at" required
        style={{border: "1px solid black"}} />
        <br />

        <label htmlFor="headcount">人数</label><br />
        <input type="number" id="headcount" name="headcount" required
        style={{border: "1px solid black"}} />
        <br />

        <label htmlFor="note">備考</label><br />
        <input type="text" id="note" name="note" required
        style={{border: "1px solid black"}} />
        <br />

        <label htmlFor="status">予約状態</label><br />
        <select id="status" name="status"
        style={{border: "1px solid black"}}>
            <option value="provisional">仮予約</option>
            <option value="approved">確定</option>
            <option value="withdrawn">承認前キャンセル</option>
            <option value="rejected">却下</option>
            <option value="cancelled">承認後キャンセル</option>
            <option value="cancelled_by_staff">承認後に事務局がキャンセル</option>
        </select>
        <br />

    </form>)
    ;

}