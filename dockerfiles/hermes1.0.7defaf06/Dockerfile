FROM rust:1.63-bullseye
WORKDIR /app
RUN PLATFORM=`uname -a | awk '{print $(NF-1)}'` && \
    git clone https://github.com/neutron-org/hermes && \
    cd hermes && \
    git checkout 7defaf067dbe6f60588518ea1619f228d38ac48d && \
    cargo build --release --bin hermes && \
    mkdir -p $HOME/.hermes/bin && \
    mv ./target/release/hermes $HOME/.hermes/bin/
ENV PATH="/root/.hermes/bin:${PATH}"

CMD ["hermes", "start"]