# CoinAnalyst — workspace local

Ứng dụng một người dùng gồm chart TradingView `OANDA:XAUUSD` và chat tiếng Việt qua Codex App Server. Khi gửi câu hỏi, app có thể tự chụp và cắt vùng chart từ tab trình duyệt bạn cấp quyền chia sẻ; không cần tự chụp, cắt hoặc tải ảnh lên. Không cần OANDA account ID, OANDA API token hay TradingView MCP.

## Yêu cầu

- Node.js 22.13 trở lên (dùng SQLite tích hợp sẵn của Node.js).
- Codex CLI đã cài và có trong `PATH` (hoặc đặt biến môi trường `CODEX_BIN`).
- Tài khoản ChatGPT/Codex để đăng nhập. Hạn mức Codex tùy gói; nếu tài khoản có Codex trong gói Free, dùng trong hạn mức đó không cần API key riêng.

## Chạy

```sh
npm install
npm run dev
```

Mở `http://127.0.0.1:5173` và chọn **Kết nối Codex** để đăng nhập ChatGPT. Dùng tab **Phân tích** để chọn symbol, khung thời gian và hỏi về chart; tab **Sổ giao dịch** để quản lý PnL và trade memory. Lần đầu gửi câu hỏi, trình duyệt hỏi quyền chia sẻ màn hình/tab: chọn tab **CoinAnalyst**. App giữ luồng chia sẻ để tự chụp riêng vùng chart mỗi lần bạn gửi câu hỏi. Có thể dừng quyền chia sẻ bằng nút **Dừng chia sẻ** hoặc thanh chia sẻ của trình duyệt.

## Cách phân tích

- Chart là widget nhúng TradingView, mã `OANDA:XAUUSD`. Khung có thể chọn bằng các nút phía trên chart.
- Widget TradingView không cung cấp API để trang web đọc nến/indicator. App dùng quyền chia sẻ tab của trình duyệt để lấy hình đã render, rồi tự cắt đúng vùng chart trước khi gửi cùng câu hỏi.
- Quick Analysis chỉ dựa trên ảnh chart đã chụp và headline tin tức; không tải feed OHLC/giá từ API bên ngoài. Entry/SL/TP là mức ước lượng từ ảnh.
- Quick Analysis trả đủ setup sẽ hiển thị kế hoạch nhưng **không tự lưu vào sổ**. Nếu muốn lưu, bạn có thể bấm **Theo dõi lệnh trong sổ**, nhắn “ghi lại lệnh”, hoặc tự thêm lệnh trong tab Sổ giao dịch. Sau khi đã lưu, app có thể chụp chart 15m đúng symbol rồi nhờ Codex đối chiếu Entry/TP/SL; kết quả chỉ là nhận định từ ảnh, không xác nhận khớp lệnh broker hay PnL tài khoản. Nếu ảnh mơ hồ, trạng thái không bị tự đóng; PnL thực tế vẫn nhập hoặc sửa thủ công.
- Nhật ký giao dịch được lưu bằng SQLite cục bộ tại `~/.xauusd-copilot/data/trading-journal.sqlite`: PnL bạn nhập cho từng lệnh, ghi chú từng ngày, ý tưởng/ghi chú lệnh và kết quả AI review. Không có đồng bộ tài khoản broker; % theo ngày là tổng các tỷ lệ PnL đã nhập. Nhật ký PnL cũ trong trình duyệt sẽ được nhập vào SQLite ở lần chạy đầu sau khi nâng cấp.
- Tab **Sổ giao dịch** cho phép thêm/sửa/xóa lệnh, xem PnL theo ngày, ghi chú ngày và yêu cầu AI review lý do dựa trên thông tin đã ghi. AI không còn ảnh chart sau khi lệnh đóng, nên review sẽ nêu giới hạn khi thiếu dữ liệu thay vì tự dựng lại diễn biến.
- AI Memory là bài học được lưu thành văn bản và chèn vào prompt của các lần phân tích sau nếu bạn bật; chỉ memory cùng symbol được dùng. Bạn có thể sửa, tắt hoặc xóa từng bài học; đây không phải huấn luyện lại trọng số model. AI review dùng hạn mức Codex của tài khoản đang kết nối.
- Trình duyệt chỉ cho phép bắt đầu chia sẻ sau thao tác người dùng và hiện hộp thoại xin quyền. Luồng chụp tự động hiện hỗ trợ Chrome/Edge; cần chọn tab CoinAnalyst. Chỉ ảnh vùng chart được gửi đến Codex khi bạn gửi câu hỏi.
- Ảnh được lưu tạm trong thư mục runtime cục bộ khi Codex xử lý, rồi xóa sau khi nhận kết quả. Nội dung hội thoại được lưu trên trình duyệt bằng `localStorage`.
- Không cần OANDA account ID/token hoặc API key OpenAI riêng. Codex vẫn dùng hạn mức của tài khoản ChatGPT/Codex và có thể bị giới hạn theo gói.
- Không thể bảo đảm AI đọc chính xác giá nhỏ hoặc mờ; phóng to chart khi cần phân tích mức cụ thể.
- Ứng dụng chỉ bind vào `127.0.0.1`; chưa cấu hình để đưa lên internet hoặc phục vụ nhiều người dùng.

## Tài liệu

- [TradingView Chart Widgets](https://www.tradingview.com/widget-docs/widgets/charts/)
- [TradingView Widget data FAQ](https://www.tradingview.com/widget-docs/faq/data/)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex theo gói ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
