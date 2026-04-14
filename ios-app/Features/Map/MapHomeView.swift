import Combine
import CoreLocation
import MapKit
import SwiftUI

struct MapHomeView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var destinationStore: DestinationStore
    @StateObject private var viewModel: MapHomeViewModel
    @StateObject private var locationProvider = CurrentLocationProvider()
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780),
        span: MKCoordinateSpan(latitudeDelta: 0.018, longitudeDelta: 0.018)
    )

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: MapHomeViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack(alignment: .top) {
            Map(coordinateRegion: $region, annotationItems: pins) { pin in
                MapAnnotation(coordinate: pin.coordinate) {
                    annotationView(for: pin)
                }
            }
            .ignoresSafeArea(edges: .top)

            VStack(spacing: 10) {
                searchPanel
                if !viewModel.destinations.isEmpty {
                    destinationResults
                }
                if let errorMessage = viewModel.errorMessage {
                    inlineError(errorMessage)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)

            VStack {
                Spacer()
                mapControls
                parkingPanel
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
        }
        .navigationTitle("주차 지도")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            locationProvider.request()
        }
        .onReceive(locationProvider.$coordinate.compactMap { $0 }.prefix(1)) { coordinate in
            moveMap(to: coordinate, span: 0.015)
        }
    }

    private var pins: [MapPinItem] {
        var items: [MapPinItem] = []
        if let coordinate = locationProvider.coordinate {
            items.append(MapPinItem(id: "current-location", coordinate: coordinate, kind: .currentLocation))
        }
        if let destination = viewModel.selectedDestination {
            items.append(MapPinItem(
                id: "destination-\(destination.id)",
                coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng),
                kind: .destination(destination)
            ))
        }
        items.append(contentsOf: viewModel.parkingLots.map { parkingLot in
            MapPinItem(
                id: "parking-\(parkingLot.id)",
                coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng),
                kind: .parking(parkingLot)
            )
        })
        return items
    }

    private var searchPanel: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("목적지, 주소, 장소명을 입력", text: $viewModel.query)
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit { Task { await viewModel.search() } }
            if viewModel.isSearching {
                ProgressView()
            } else {
                Button("검색") {
                    Task { await viewModel.search() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .padding(12)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
    }

    private var destinationResults: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(viewModel.destinations) { destination in
                    Button {
                        destinationStore.addRecent(destination)
                        moveMap(to: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng), span: 0.01)
                        Task { await viewModel.select(destination) }
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(.red)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(destination.name)
                                    .font(.headline)
                                Text(destination.address)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                        }
                        .padding(12)
                    }
                    .buttonStyle(.plain)
                    Divider()
                        .padding(.leading, 40)
                }
            }
        }
        .frame(maxHeight: 230)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
    }

    private var mapControls: some View {
        HStack {
            Spacer()
            Button {
                if let coordinate = locationProvider.coordinate {
                    moveMap(to: coordinate, span: 0.015)
                } else {
                    locationProvider.request()
                }
            } label: {
                Image(systemName: "location.fill")
                    .font(.headline)
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.borderedProminent)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private var parkingPanel: some View {
        if let destination = viewModel.selectedDestination {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(destination.name)
                            .font(.headline)
                        Text(destination.address)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if viewModel.isLoadingParking {
                        ProgressView()
                    }
                }

                if viewModel.recommendedParkingLots.isEmpty && !viewModel.isLoadingParking {
                    Text("주변 주차장을 찾지 못했습니다.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(viewModel.recommendedParkingLots) { parkingLot in
                                ParkingMapCard(
                                    parkingLot: parkingLot,
                                    isDestinationParking: viewModel.isDestinationParking(parkingLot, for: destination),
                                    isSelected: viewModel.selectedParkingLot?.id == parkingLot.id,
                                    onSelect: {
                                        viewModel.selectedParkingLot = parkingLot
                                        moveMap(to: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng), span: 0.008)
                                    },
                                    onDetail: {
                                        router.showDetail(destination: destination, parkingLot: parkingLot)
                                    },
                                    onNavigate: {
                                        router.startNavigation(destination: destination, parkingLot: parkingLot)
                                    }
                                )
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .padding(12)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .black.opacity(0.16), radius: 12, y: 6)
        }
    }

    private func annotationView(for pin: MapPinItem) -> some View {
        Group {
            switch pin.kind {
            case .currentLocation:
                Circle()
                    .fill(.blue)
                    .frame(width: 16, height: 16)
                    .overlay(Circle().stroke(.white, lineWidth: 3))
                    .shadow(radius: 4)
            case .destination:
                Image(systemName: "flag.circle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(.red)
                    .background(Circle().fill(.white).frame(width: 22, height: 22))
                    .shadow(radius: 4)
            case .parking(let parkingLot):
                Button {
                    viewModel.selectedParkingLot = parkingLot
                    moveMap(to: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng), span: 0.008)
                } label: {
                    VStack(spacing: 2) {
                        Text(parkingLot.availableSpaces.map { "\($0)" } ?? "P")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(minWidth: 34, minHeight: 28)
                            .background(markerColor(for: parkingLot))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Image(systemName: "triangle.fill")
                            .font(.system(size: 9))
                            .rotationEffect(.degrees(180))
                            .foregroundStyle(markerColor(for: parkingLot))
                            .offset(y: -4)
                    }
                }
                .buttonStyle(.plain)
                .shadow(radius: 3)
            }
        }
    }

    private func inlineError(_ message: String) -> some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.white)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.88))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func markerColor(for parkingLot: ParkingLot) -> Color {
        if parkingLot.stale { return .gray }
        switch parkingLot.congestionStatus {
        case .available:
            return .green
        case .moderate:
            return .orange
        case .busy, .full:
            return .red
        case .unknown:
            return .blue
        }
    }

    private func moveMap(to coordinate: CLLocationCoordinate2D, span: CLLocationDegrees) {
        withAnimation {
            region = MKCoordinateRegion(
                center: coordinate,
                span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)
            )
        }
    }
}

private struct ParkingMapCard: View {
    let parkingLot: ParkingLot
    let isDestinationParking: Bool
    let isSelected: Bool
    let onSelect: () -> Void
    let onDetail: () -> Void
    let onNavigate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if isDestinationParking {
                    Text("목적지 주차장")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.green.opacity(0.16))
                        .foregroundStyle(.green)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Text("\(parkingLot.distanceFromDestinationMeters)m")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(parkingLot.name)
                .font(.headline)
                .lineLimit(2)
            Text(parkingLot.displayStatus)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(statusColor)
            Text(parkingLot.feeSummary ?? "요금 정보 없음")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack {
                Button("상세") { onDetail() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("길안내") { onNavigate() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .frame(width: 250, alignment: .leading)
        .background(isSelected ? Color.blue.opacity(0.10) : Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
        )
        .onTapGesture(perform: onSelect)
    }

    private var statusColor: Color {
        switch parkingLot.congestionStatus {
        case .available:
            return .green
        case .moderate:
            return .orange
        case .busy, .full:
            return .red
        case .unknown:
            return .secondary
        }
    }
}
