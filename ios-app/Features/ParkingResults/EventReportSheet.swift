import SwiftUI

/// 같은 기기가 같은 행사를 반복 신고하는 것만 막는다. 서버에 신고자 식별자를 보내지
/// 않기 때문에 중복 억제는 기기 쪽에서 한다.
enum EventReportedStore {
    private static let key = "eventReports.submitted"

    static func contains(kind: String, id: String) -> Bool {
        submitted().contains("\(kind):\(id)")
    }

    static func mark(kind: String, id: String) {
        var set = submitted()
        set.insert("\(kind):\(id)")
        UserDefaults.standard.set(Array(set), forKey: key)
    }

    private static func submitted() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }
}

struct EventReportSheet: View {
    let eventKind: String
    let eventId: String
    let eventTitle: String
    let apiClient: APIClientProtocol

    @Environment(\.dismiss) private var dismiss
    @State private var reason: EventReportReason = .ended
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(eventTitle)
                        .font(.festival(.headline))
                        .foregroundStyle(FestivalDesign.navy)
                        .fixedSize(horizontal: false, vertical: true)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("어떤 점이 잘못됐나요?")
                            .font(.festival(.subheadline, weight: .semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        ForEach(EventReportReason.allCases) { item in
                            Button {
                                reason = item
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: reason == item ? "largecircle.fill.circle" : "circle")
                                        .foregroundStyle(reason == item ? FestivalDesign.coralText : FestivalDesign.secondaryText)
                                    Text(item.displayName)
                                        .font(.festival(.subheadline))
                                        .foregroundStyle(FestivalDesign.navy)
                                    Spacer(minLength: 0)
                                }
                                .padding(10)
                                .background(FestivalDesign.cream.opacity(reason == item ? 0.6 : 0.25))
                                .clipShape(FestivalDesign.controlShape)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(14)
                    .festivalCard()

                    VStack(alignment: .leading, spacing: 8) {
                        Text("자세한 내용 (선택)")
                            .font(.festival(.subheadline, weight: .semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        TextEditor(text: $note)
                            .font(.festival(.subheadline))
                            .frame(height: 100)
                            .padding(6)
                            .background(FestivalDesign.cream.opacity(0.25))
                            .clipShape(FestivalDesign.controlShape)
                        Text("개인정보(이름, 연락처 등)는 적지 말아 주세요. 신고 내용에는 작성자를 식별하는 정보를 저장하지 않습니다.")
                            .font(.festival(.caption))
                            .foregroundStyle(FestivalDesign.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(14)
                    .festivalCard()

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.festival(.caption))
                            .foregroundStyle(FestivalDesign.coralText)
                    }
                }
                .padding(16)
            }
            .background(FestivalDesign.background.ignoresSafeArea())
            .festivalNavigationTitle("정보 오류 신고")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "보내는 중" : "보내기") { submit() }
                        .disabled(isSubmitting)
                }
            }
        }
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let submission = EventReportSubmission(
            eventKind: eventKind,
            eventId: eventId,
            eventTitle: eventTitle,
            reason: reason.rawValue,
            note: trimmedNote.isEmpty ? nil : String(trimmedNote.prefix(500))
        )
        Task {
            do {
                try await apiClient.submitEventReport(submission)
                EventReportedStore.mark(kind: eventKind, id: eventId)
                AnalyticsService.shared.track(.reportSubmit, label: eventKind)
                dismiss()
            } catch {
                isSubmitting = false
                errorMessage = "신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요."
            }
        }
    }
}
