;; InvestmentToken.clar

(define-fungible-token wind-share)

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-FARM-NOT-REGISTERED u101)
(define-constant ERR-INSUFFICIENT-BALANCE u102)
(define-constant ERR-ZERO-AMOUNT u103)
(define-constant ERR-INVALID-FARM-ID u104)

(define-data-var contract-owner principal tx-sender)
(define-data-var yield-distributor principal (as-contract tx-sender))

(define-map farm-tokens
  uint
  {
    total-supply: uint,
    farm-name: (string-utf8 64),
    capacity-mw: uint
  }
)

(define-read-only (get-token-balance (owner principal))
  (ft-get-balance wind-share owner)
)

(define-read-only (get-total-supply)
  (ft-get-supply wind-share)
)

(define-read-only (get-farm-info (farm-id uint))
  (map-get? farm-tokens farm-id)
)

(define-read-only (get-farm-balance (farm-id uint) (owner principal))
  (let (
        (farm (unwrap! (get-farm-info farm-id) (err ERR-FARM-NOT-REGISTERED)))
      )
    (ok (ft-get-balance wind-share owner))
  )
)

(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

(define-public (set-yield-distributor (distributor principal))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (var-set yield-distributor distributor)
    (ok true)
  )
)

(define-public (register-farm (farm-id uint) (name (string-utf8 64)) (capacity-mw uint) (initial-supply uint))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (asserts! (> initial-supply u0) (err ERR-ZERO-AMOUNT))
    (asserts! (is-none (get-farm-info farm-id)) (err ERR-FARM-NOT-REGISTERED))
    (try! (ft-mint? wind-share initial-supply tx-sender))
    (map-set farm-tokens farm-id
      {
        total-supply: initial-supply,
        farm-name: name,
        capacity-mw: capacity-mw
      }
    )
    (let ((distributor (var-get yield-distributor)))
      (try! (contract-call? distributor register-farm farm-id initial-supply))
    )
    (ok true)
  )
)

(define-public (buy-shares (farm-id uint) (amount uint))
  (let (
        (buyer tx-sender)
        (farm (unwrap! (get-farm-info farm-id) (err ERR-FARM-NOT-REGISTERED)))
        (current-supply (get total-supply farm))
        (new-supply (+ current-supply amount))
      )
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (try! (stx-transfer? (* amount u1000000) buyer (as-contract tx-sender)))
    (try! (ft-mint? wind-share amount buyer))
    (map-set farm-tokens farm-id
      (merge farm { total-supply: new-supply })
    )
    (let ((distributor (var-get yield-distributor)))
      (try! (contract-call? distributor update-shares farm-id buyer new-supply))
    )
    (ok true)
  )
)

(define-public (sell-shares (farm-id uint) (amount uint))
  (let (
        (seller tx-sender)
        (balance (ft-get-balance wind-share seller))
        (farm (unwrap! (get-farm-info farm-id) (err ERR-FARM-NOT-REGISTERED)))
        (current-supply (get total-supply farm))
        (new-supply (- current-supply amount))
      )
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (try! (ft-burn? wind-share amount seller))
    (map-set farm-tokens farm-id
      (merge farm { total-supply: new-supply })
    )
    (let ((distributor (var-get yield-distributor)))
      (try! (contract-call? distributor update-shares farm-id seller new-supply))
    )
    (try! (as-contract (stx-transfer? (* amount u1000000) tx-sender seller)))
    (ok true)
  )
)

(define-public (transfer-shares (farm-id uint) (amount uint) (recipient principal))
  (let (
        (sender tx-sender)
        (balance (ft-get-balance wind-share sender))
      )
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (try! (ft-transfer? wind-share amount sender recipient))
    (let ((distributor (var-get yield-distributor)))
      (try! (contract-call? distributor update-shares farm-id sender (ft-get-balance wind-share sender)))
      (try! (contract-call? distributor update-shares farm-id recipient (ft-get-balance wind-share recipient)))
    )
    (ok true)
  )
)

(define-public (claim-yield (farm-id uint))
  (let ((distributor (var-get yield-distributor)))
    (contract-call? distributor claim-yield farm-id)
  )
)